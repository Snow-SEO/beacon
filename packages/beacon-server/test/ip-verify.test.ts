import assert from "node:assert/strict";
import { promises as dns } from "node:dns";
import { afterEach, describe, it, mock } from "node:test";
import { parseCidr } from "../src/cidr-match.js";
import {
	__clearRangesForTest,
	__setProviderRangesForTest,
	hasPublishedRanges,
} from "../src/crawler-ranges.js";
import { verifyByReverseDns, verifyCrawlerIpSync } from "../src/ip-verify.js";

function ranges(...cidrs: string[]) {
	return cidrs
		.map(parseCidr)
		.filter((c): c is NonNullable<typeof c> => c !== null);
}
describe("verifyCrawlerIpSync", () => {
	afterEach(() => {
		__clearRangesForTest();
	});
	it("verifies an IP inside the claimed provider's range", () => {
		__setProviderRangesForTest("OpenAI", ranges("203.0.113.0/24"));
		assert.deepEqual(verifyCrawlerIpSync("203.0.113.10", "OpenAI"), {
			verified: true,
			state: "verified",
			method: "cidr",
		});
	});
	it("verifies an IPv6 hit inside the claimed provider's range", () => {
		__setProviderRangesForTest("OpenAI", ranges("2600:1f18::/32"));
		assert.equal(
			verifyCrawlerIpSync("2600:1f18:aa::5", "OpenAI").state,
			"verified",
		);
	});
	it("flags a claimed provider whose loaded ranges do not contain the IP", () => {
		__setProviderRangesForTest("OpenAI", ranges("203.0.113.0/24"));
		assert.deepEqual(verifyCrawlerIpSync("198.51.100.5", "OpenAI"), {
			verified: false,
			state: "spoofed_suspected",
			method: "cidr",
		});
	});
	it("flags an IP that belongs to a different provider than the UA claims", () => {
		__setProviderRangesForTest("Google", ranges("198.51.100.0/24"));
		assert.equal(
			verifyCrawlerIpSync("198.51.100.5", "OpenAI").state,
			"spoofed_suspected",
		);
	});
	it("stays unverified when no ranges are loaded (cold cache must not false-flag)", () => {
		assert.equal(
			verifyCrawlerIpSync("203.0.113.10", "OpenAI").state,
			"unverified",
		);
	});
	it("stays unverified for a provider without a published list and no owning range", () => {
		__setProviderRangesForTest("OpenAI", ranges("203.0.113.0/24"));
		assert.equal(
			verifyCrawlerIpSync("192.0.2.1", "Anthropic").state,
			"unverified",
		);
	});
	it("stays unverified for a missing IP", () => {
		assert.equal(verifyCrawlerIpSync(undefined, "OpenAI").state, "unverified");
		assert.equal(
			verifyCrawlerIpSync("not-an-ip", "OpenAI").state,
			"unverified",
		);
	});
	it("treats Meta as having a published list (resolved by ASN, not a feed)", () => {
		assert.equal(hasPublishedRanges("Meta"), true);
	});
});
describe("verifyByReverseDns", () => {
	afterEach(() => {
		mock.restoreAll();
	});
	function stubDns(over: {
		reverse?: () => Promise<string[]>;
		resolve4?: () => Promise<string[]>;
	}) {
		mock.method(
			dns,
			"reverse",
			over.reverse ?? (() => Promise.resolve<string[]>([])),
		);
		mock.method(
			dns,
			"resolve4",
			over.resolve4 ?? (() => Promise.resolve<string[]>([])),
		);
	}
	it("verifies a PTR under the provider's suffix that forward-confirms", async () => {
		stubDns({
			reverse: () => Promise.resolve(["1-2-3-4.crawl.amazonbot.amazon"]),
			resolve4: () => Promise.resolve(["1.2.3.4"]),
		});
		const verdict = await verifyByReverseDns("1.2.3.4", "Amazon");
		assert.equal(verdict.state, "verified");
		assert.equal(verdict.verified, true);
		assert.equal(verdict.method, "reverse_dns");
	});
	it("flags a PTR that belongs to someone other than the claimed provider", async () => {
		stubDns({
			reverse: () => Promise.resolve(["some-vps.hosting.example"]),
		});
		const verdict = await verifyByReverseDns("1.2.3.4", "Amazon");
		assert.equal(verdict.state, "spoofed_suspected");
		assert.equal(verdict.method, "reverse_dns");
	});
	it("flags a PTR that names the provider but does not forward-confirm", async () => {
		stubDns({
			reverse: () => Promise.resolve(["fake.crawl.amazonbot.amazon"]),
			resolve4: () => Promise.resolve(["9.9.9.9"]),
		});
		const verdict = await verifyByReverseDns("1.2.3.4", "Amazon");
		assert.equal(verdict.state, "spoofed_suspected");
		assert.equal(verdict.method, "reverse_dns");
	});
	it("stays unverified when the address has no PTR at all", async () => {
		stubDns({
			reverse: () => {
				const err = new Error("no PTR") as NodeJS.ErrnoException;
				err.code = "ENOTFOUND";
				return Promise.reject(err);
			},
		});
		const verdict = await verifyByReverseDns("1.2.3.4", "Amazon");
		assert.equal(verdict.state, "unverified");
		assert.equal(verdict.method, "reverse_dns");
	});
	it("draws no conclusion when the lookup itself fails transiently", async () => {
		stubDns({
			reverse: () => {
				const err = new Error("timeout") as NodeJS.ErrnoException;
				err.code = "ETIMEOUT";
				return Promise.reject(err);
			},
		});
		const verdict = await verifyByReverseDns("1.2.3.4", "Amazon");
		assert.equal(verdict.state, "unverified");
		assert.equal(verdict.method, null);
	});
	it("draws no conclusion for a provider with no authenticating suffix", async () => {
		const verdict = await verifyByReverseDns("1.2.3.4", "OpenAI");
		assert.equal(verdict.state, "unverified");
		assert.equal(verdict.method, null);
	});
});
