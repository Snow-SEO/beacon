import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	hostMatchesAllowList,
	isWellFormedHit,
	MAX_HITS_PER_REQUEST,
	normalizeHost,
	parseOccurredAt,
	utcDate,
	validateIngestBody,
} from "../src/protocol.js";

const HOST_REQUIRED_RE = /`host` must be a non-empty string/;

const NON_EMPTY_ARRAY_RE = /non-empty array/;

const TOO_MANY_HITS_RE = /exceeds 500 items/;
describe("validateIngestBody", () => {
	it("accepts a minimal batch", () => {
		assert.equal(
			validateIngestBody({
				host: "example.com",
				hits: [{ path: "/", userAgent: "GPTBot" }],
			}),
			null,
		);
	});
	it("rejects a missing host", () => {
		assert.match(validateIngestBody({ hits: [{}] }) ?? "", HOST_REQUIRED_RE);
	});
	it("rejects an empty hits array", () => {
		assert.match(
			validateIngestBody({ host: "example.com", hits: [] }) ?? "",
			NON_EMPTY_ARRAY_RE,
		);
	});
	it("rejects a batch over the per-request cap", () => {
		const hits = new Array(MAX_HITS_PER_REQUEST + 1).fill({
			path: "/",
			userAgent: "GPTBot",
		});
		assert.match(
			validateIngestBody({ host: "example.com", hits }) ?? "",
			TOO_MANY_HITS_RE,
		);
	});
	it("rejects a non-object body", () => {
		assert.ok(validateIngestBody("hello"));
		assert.ok(validateIngestBody(null));
	});
});
describe("isWellFormedHit", () => {
	it("requires a non-empty path and user agent", () => {
		assert.equal(isWellFormedHit({ path: "/a", userAgent: "GPTBot" }), true);
		assert.equal(isWellFormedHit({ path: "", userAgent: "GPTBot" }), false);
		assert.equal(isWellFormedHit({ path: "/a", userAgent: "" }), false);
	});
});
describe("normalizeHost", () => {
	it("strips scheme, path, port and a leading www", () => {
		assert.equal(
			normalizeHost("https://WWW.Example.com:8443/blog"),
			"example.com",
		);
	});
});
describe("hostMatchesAllowList", () => {
	it("matches exactly", () => {
		assert.equal(hostMatchesAllowList("example.com", ["example.com"]), true);
		assert.equal(hostMatchesAllowList("other.com", ["example.com"]), false);
	});
	it("matches a wildcard at any subdomain depth, and the apex", () => {
		const list = ["*.example.com"];
		assert.equal(hostMatchesAllowList("blog.example.com", list), true);
		assert.equal(hostMatchesAllowList("a.b.example.com", list), true);
		assert.equal(hostMatchesAllowList("example.com", list), true);
	});
	it("does not let a wildcard leak into a lookalike domain", () => {
		assert.equal(
			hostMatchesAllowList("notexample.com", ["*.example.com"]),
			false,
		);
	});
});
describe("parseOccurredAt", () => {
	const now = Date.parse("2026-07-30T12:00:00.000Z");
	it("keeps a timestamp inside the drift window", () => {
		const at = parseOccurredAt("2026-07-30T09:00:00.000Z", now);
		assert.equal(at.toISOString(), "2026-07-30T09:00:00.000Z");
	});
	it("falls back to now for a skewed client clock", () => {
		const at = parseOccurredAt("2019-01-01T00:00:00.000Z", now);
		assert.equal(at.getTime(), now);
	});
	it("falls back to now for an unparseable or absent value", () => {
		assert.equal(parseOccurredAt("not a date", now).getTime(), now);
		assert.equal(parseOccurredAt(undefined, now).getTime(), now);
	});
});
describe("utcDate", () => {
	it("buckets by UTC day regardless of local zone", () => {
		assert.equal(utcDate(new Date("2026-07-30T23:59:59.999Z")), "2026-07-30");
	});
});
