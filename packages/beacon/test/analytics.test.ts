import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BeaconAnalytics, normalizeIngestEndpoint } from "../src/analytics.js";

const KEY = "sb_live_team_abc";

const GPTBOT =
	"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

const CLAUDE_CODE = "axios/1.8.4";

const CHROME =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";

const FIREFOX =
	"Mozilla/5.0 (X11; Linux x86_64; rv:149.0) Gecko/20100101 Firefox/149.0";

const NOT_FOUND = /404/;

function stubFetch(status = 200) {
	const calls: {
		url: string;
		body: unknown;
	}[] = [];
	const fetchImpl = ((url: string, init: RequestInit) => {
		calls.push({ url, body: JSON.parse(String(init.body)) });
		return Promise.resolve(
			new Response("", {
				status,
				statusText: status === 200 ? "OK" : "Not Found",
			}),
		);
	}) as unknown as typeof fetch;
	return { calls, fetchImpl };
}
describe("normalizeIngestEndpoint", () => {
	it("appends the ingest path to a bare origin", () => {
		assert.equal(
			normalizeIngestEndpoint("https://api.example.com"),
			"https://api.example.com/v3/beacon/hits",
		);
		assert.equal(
			normalizeIngestEndpoint("https://box.tail1234.ts.net:8443/"),
			"https://box.tail1234.ts.net:8443/v3/beacon/hits",
		);
	});
	it("leaves an endpoint that already names a path alone", () => {
		assert.equal(
			normalizeIngestEndpoint("https://api.example.com/v3/beacon/hits"),
			"https://api.example.com/v3/beacon/hits",
		);
		assert.equal(
			normalizeIngestEndpoint("https://api.example.com/custom/ingest"),
			"https://api.example.com/custom/ingest",
		);
	});
});
describe("BeaconAnalytics", () => {
	it("reports a rejected batch instead of swallowing it", async () => {
		const errors: unknown[] = [];
		const { fetchImpl } = stubFetch(404);
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
			onError: (error) => errors.push(error),
		});
		analytics.record({ path: "/", userAgent: GPTBOT });
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		assert.equal(errors.length, 1);
		assert.match(String(errors[0]), NOT_FOUND);
	});
	it("stays quiet when the batch is accepted", async () => {
		const errors: unknown[] = [];
		const { fetchImpl, calls } = stubFetch(200);
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
			onError: (error) => errors.push(error),
		});
		analytics.record({ path: "/", userAgent: GPTBOT });
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		assert.equal(errors.length, 0);
		assert.equal(calls.length, 1);
	});
	it("records a markdown request from an unrecognised User-Agent", async () => {
		const { fetchImpl, calls } = stubFetch();
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
		});
		analytics.record({
			path: "/pricing",
			userAgent: CLAUDE_CODE,
			askedForMarkdown: true,
		});
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		assert.equal(calls.length, 1);
		const body = calls[0]?.body as {
			hits: {
				path: string;
			}[];
		};
		assert.equal(body.hits[0]?.path, "/pricing");
	});
	it("ignores a person browsing", () => {
		const { fetchImpl, calls } = stubFetch();
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
		});
		analytics.record({
			path: "/",
			userAgent: CHROME,
			fromBrowser: true,
		});
		analytics.flush();
		assert.equal(calls.length, 0);
	});
	it("reports an unknown non-browser client so the server can classify it", async () => {
		const { fetchImpl, calls } = stubFetch();
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
		});
		analytics.record({
			path: "/pricing",
			userAgent: "Mozilla/5.0 (compatible; SomeBotShippedAfterThisBuild/1.0)",
		});
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		assert.equal(calls.length, 1);
	});
	it("reports a browser-shaped client that negotiated for markdown", async () => {
		const { fetchImpl, calls } = stubFetch();
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
		});
		analytics.record({
			path: "/terms",
			userAgent: FIREFOX,
			askedForMarkdown: true,
			fromBrowser: true,
		});
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		assert.equal(calls.length, 1);
	});
	it("forwards Web Bot Auth headers untouched", async () => {
		const { fetchImpl, calls } = stubFetch();
		const analytics = new BeaconAnalytics({
			key: KEY,
			host: "example.com",
			fetch: fetchImpl,
		});
		analytics.record({
			path: "/",
			userAgent: GPTBOT,
			signature: "sig1=:abc:",
			signatureInput: 'sig1=("@authority");tag="web-bot-auth"',
			signatureAgent: '"https://agent.bot.goog"',
		});
		const pending: Promise<unknown>[] = [];
		analytics.flush({ waitUntil: (p) => pending.push(p) });
		await Promise.all(pending);
		const body = calls[0]?.body as {
			hits: {
				signatureAgent?: string;
			}[];
		};
		assert.equal(body.hits[0]?.signatureAgent, '"https://agent.bot.goog"');
	});
});
