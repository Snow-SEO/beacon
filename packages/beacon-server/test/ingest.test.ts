import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { type ParsedCidr, parseCidr } from "../src/cidr-match.js";
import {
	__clearRangesForTest,
	__setProviderRangesForTest,
} from "../src/crawler-ranges.js";
import {
	__clearDatacenterRangesForTest,
	__setDatacenterRangesForTest,
} from "../src/datacenter-ranges.js";
import { ingestBatch } from "../src/ingest.js";
import type { IncomingHit } from "../src/protocol.js";

const GPTBOT_UA =
	"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

const OPENAI_RANGE = "20.171.207.0/24";

const HUAWEI_HK = "27.106.96.0/20";

const CHROME_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const BROWSER_HEADERS = {
	"sec-fetch-mode": "navigate",
	"sec-fetch-dest": "document",
	"sec-fetch-site": "none",
};

function seedOpenAi(): void {
	__setProviderRangesForTest("OpenAI", [parseCidr(OPENAI_RANGE) as ParsedCidr]);
}
afterEach(() => {
	__clearRangesForTest();
	__clearDatacenterRangesForTest();
});
describe("ingestBatch", () => {
	it("classifies a registered crawler and verifies it by CIDR", async () => {
		seedOpenAi();
		const result = await ingestBatch("example.com", [
			{
				path: "/pricing",
				userAgent: GPTBOT_UA,
				ip: "20.171.207.5",
				format: "html",
			},
		]);
		assert.equal(result.accepted, 1);
		assert.equal(result.skipped, 0);
		const [row] = result.rows;
		assert.equal(row.provider, "OpenAI");
		assert.equal(row.host, "example.com");
		assert.equal(row.verified, true);
		assert.equal(row.verifyState, "verified");
		assert.equal(row.verifyMethod, "cidr");
	});
	it("flags a UA claiming a provider its address contradicts", async () => {
		seedOpenAi();
		const result = await ingestBatch("example.com", [
			{ path: "/", userAgent: GPTBOT_UA, ip: "203.0.113.9" },
		]);
		assert.equal(result.rows[0].verifyState, "spoofed_suspected");
		assert.equal(result.rows[0].verified, false);
	});
	it("counts a markdown-negotiating client with no registry match", async () => {
		const result = await ingestBatch("example.com", [
			{
				path: "/docs.md",
				userAgent: "axios/1.8.4",
				askedForMarkdown: true,
				format: "markdown",
			},
		]);
		assert.equal(result.accepted, 1);
		assert.equal(result.rows[0].agent, "axios");
		assert.equal(result.rows[0].category, "markdown_client");
	});
	it("drops a markdown request a real browser made", async () => {
		const result = await ingestBatch("example.com", [
			{
				path: "/docs.md",
				userAgent: CHROME_UA,
				askedForMarkdown: true,
				headers: BROWSER_HEADERS,
			},
		]);
		assert.equal(result.accepted, 0);
		assert.equal(result.reasons.unrecognized, 1);
	});
	it("keeps a browser-shaped request that came from a datacenter", async () => {
		__setDatacenterRangesForTest([HUAWEI_HK]);
		const result = await ingestBatch("example.com", [
			{
				path: "/docs.md",
				userAgent: CHROME_UA,
				askedForMarkdown: true,
				ip: "27.106.106.73",
				headers: BROWSER_HEADERS,
			},
		]);
		assert.equal(result.accepted, 1);
		assert.equal(result.rows[0].agent, "Automated browser");
	});
	it("counts a malformed hit without failing the batch", async () => {
		const result = await ingestBatch("example.com", [
			{ path: "", userAgent: GPTBOT_UA },
			{ path: "/ok", userAgent: GPTBOT_UA },
		] as IncomingHit[]);
		assert.equal(result.accepted, 1);
		assert.equal(result.reasons.malformed, 1);
	});
	it("samples at most five dropped agents, without a path or address", async () => {
		const hits: IncomingHit[] = Array.from({ length: 9 }, (_, i) => ({
			path: `/${i}`,
			userAgent: `unknown-client-${i}/1.0`,
			ip: "203.0.113.9",
		}));
		const result = await ingestBatch("example.com", hits);
		assert.equal(result.reasons.unrecognized, 9);
		assert.equal(result.droppedAgents.length, 5);
		assert.ok(result.droppedAgents.every((ua) => !ua.includes("203.0.113.9")));
	});
	it("rolls a batch up per day and agent", async () => {
		seedOpenAi();
		const at = new Date(Date.now() - 60_000).toISOString();
		const result = await ingestBatch("example.com", [
			{
				path: "/a",
				userAgent: GPTBOT_UA,
				occurredAt: at,
				format: "html",
				ip: "20.171.207.5",
			},
			{
				path: "/b",
				userAgent: GPTBOT_UA,
				occurredAt: at,
				format: "markdown",
				ip: "20.171.207.6",
			},
			{
				path: "/c",
				userAgent: GPTBOT_UA,
				occurredAt: at,
				format: "html",
				ip: "203.0.113.9",
			},
		]);
		assert.equal(result.rollups.length, 1);
		const [rollup] = result.rollups;
		assert.equal(rollup.date, at.slice(0, 10));
		assert.equal(rollup.hits, 3);
		assert.equal(rollup.htmlHits, 2);
		assert.equal(rollup.markdownHits, 1);
		assert.equal(rollup.verifiedHits, 2);
	});
	it("defers reverse DNS only for providers that publish a PTR suffix", async () => {
		const result = await ingestBatch("example.com", [
			{
				path: "/a",
				userAgent:
					"Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)",
				ip: "17.58.98.1",
			},
			{ path: "/b", userAgent: GPTBOT_UA, ip: "203.0.113.9" },
		]);
		assert.equal(result.deferred.length, 1);
		assert.equal(result.deferred[0].provider, "Apple");
	});
	it("hashes the address when a transform is supplied", async () => {
		seedOpenAi();
		const result = await ingestBatch(
			"example.com",
			[{ path: "/", userAgent: GPTBOT_UA, ip: "20.171.207.5" }],
			{ transformIp: () => "hashed" },
		);
		assert.equal(result.rows[0].ip, "hashed");
		assert.equal(result.rows[0].verified, true);
	});
	it("drops the address entirely when the transform returns null", async () => {
		const result = await ingestBatch(
			"example.com",
			[{ path: "/", userAgent: GPTBOT_UA, ip: "20.171.207.5" }],
			{ transformIp: () => null },
		);
		assert.equal(result.rows[0].ip, null);
	});
});
