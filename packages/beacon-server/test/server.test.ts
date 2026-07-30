import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { type ParsedCidr, parseCidr } from "../src/cidr-match.js";
import {
	__clearRangesForTest,
	__setProviderRangesForTest,
} from "../src/crawler-ranges.js";
import { __setDatacenterRangesForTest } from "../src/datacenter-ranges.js";
import { BEACON_INGEST_PATH } from "../src/protocol.js";
import {
	createBeaconServer,
	type StartedBeaconServer,
	startBeaconServer,
} from "../src/server/app.js";
import { KeyRegistry, parseKeysFromEnv } from "../src/server/auth.js";
import { MemoryHitStore } from "../src/store/memory.js";

const GPTBOT_UA =
	"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot";

const OPEN_KEY = "sk_open_key";

const SCOPED_KEY = "sk_scoped_key";

const HASHED_IP_RE = /^[0-9a-f]{32}$/;

const NO_KEYS_RE = /No beacon keys configured/;

let started: StartedBeaconServer;

let store: MemoryHitStore;

let base: string;

function seedRanges(): void {
	__setProviderRangesForTest("OpenAI", [
		parseCidr("20.171.207.0/24") as ParsedCidr,
	]);
	__setDatacenterRangesForTest(["27.106.96.0/20"]);
}

function post(body: unknown, key = OPEN_KEY): Promise<Response> {
	return fetch(`${base}${BEACON_INGEST_PATH}`, {
		method: "POST",
		headers: { "content-type": "application/json", "x-beacon-key": key },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}
before(async () => {
	seedRanges();
	store = new MemoryHitStore();
	started = await startBeaconServer({
		store,
		keys: [
			{ key: OPEN_KEY },
			{ key: SCOPED_KEY, allowedHosts: ["*.example.com"] },
		],
		ipMode: "hash",
		ipSalt: "test-salt",
		port: 0,
		host: "127.0.0.1",
		warmRanges: false,
	});
	base = `http://127.0.0.1:${started.port}`;
});
after(async () => {
	await started.close();
	__clearRangesForTest();
});
afterEach(() => {
	store.hits.length = 0;
	store.rollups.clear();
});
describe("GET /health", () => {
	it("reports ok", async () => {
		const res = await fetch(`${base}/health`);
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { status: "ok" });
	});
});
describe("POST /v3/beacon/hits", () => {
	it("accepts a batch and stores the classified hits", async () => {
		const res = await post({
			host: "example.com",
			hits: [
				{
					path: "/a",
					userAgent: GPTBOT_UA,
					ip: "20.171.207.5",
					format: "html",
				},
				{ path: "/b", userAgent: "axios/1.8.4", askedForMarkdown: true },
				{ path: "/c", userAgent: "curl/8.0" },
			],
		});
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), {
			accepted: 2,
			skipped: 1,
			reasons: { malformed: 0, unrecognized: 1 },
		});
		assert.equal(store.hits.length, 2);
		assert.equal(store.hits[0].verifyState, "verified");
	});
	it("hashes the address rather than storing it", async () => {
		await post({
			host: "example.com",
			hits: [{ path: "/a", userAgent: GPTBOT_UA, ip: "20.171.207.5" }],
		});
		assert.notEqual(store.hits[0].ip, "20.171.207.5");
		assert.match(String(store.hits[0].ip), HASHED_IP_RE);
	});
	it("rejects a missing or unknown key with 401", async () => {
		assert.equal(
			(await post({ host: "example.com", hits: [] }, "nope")).status,
			401,
		);
		const res = await fetch(`${base}${BEACON_INGEST_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		assert.equal(res.status, 401);
	});
	it("rejects a host outside the key's allow-list by name", async () => {
		const res = await post(
			{ host: "other.com", hits: [{ path: "/a", userAgent: GPTBOT_UA }] },
			SCOPED_KEY,
		);
		assert.equal(res.status, 403);
		assert.equal((await res.json()).code, "BEACON_HOST_NOT_ALLOWED");
	});
	it("accepts a host the allow-list wildcard covers", async () => {
		const res = await post(
			{
				host: "blog.example.com",
				hits: [{ path: "/a", userAgent: GPTBOT_UA }],
			},
			SCOPED_KEY,
		);
		assert.equal(res.status, 200);
	});
	it("rejects malformed JSON and an invalid body with 400", async () => {
		assert.equal((await post("{not json")).status, 400);
		assert.equal((await post({ hits: [] })).status, 400);
	});
	it("rejects an oversized body with 413", async () => {
		const small = await startBeaconServer({
			store: new MemoryHitStore(),
			keys: [{ key: OPEN_KEY }],
			maxBodyBytes: 64,
			port: 0,
			host: "127.0.0.1",
			warmRanges: false,
		});
		try {
			const res = await fetch(
				`http://127.0.0.1:${small.port}${BEACON_INGEST_PATH}`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-beacon-key": OPEN_KEY,
					},
					body: JSON.stringify({
						host: "example.com",
						hits: [{ path: `/${"x".repeat(500)}`, userAgent: GPTBOT_UA }],
					}),
				},
			);
			assert.equal(res.status, 413);
		} finally {
			await small.close();
		}
	});
	it("404s an unknown path and 405s a wrong method", async () => {
		assert.equal((await fetch(`${base}/nope`)).status, 404);
		assert.equal((await fetch(`${base}${BEACON_INGEST_PATH}`)).status, 405);
	});
});
describe("key configuration", () => {
	it("refuses to start with no keys", () => {
		assert.throws(
			() =>
				createBeaconServer({
					store: new MemoryHitStore(),
					keys: [],
					warmRanges: false,
				}),
			NO_KEYS_RE,
		);
	});
	it("parses bare keys and host-scoped keys from one env string", () => {
		const keys = parseKeysFromEnv(
			"sk_a sk_b@example.com,*.example.org; sk_c@only.test",
		);
		assert.deepEqual(keys, [
			{ key: "sk_a" },
			{ key: "sk_b", allowedHosts: ["example.com", "*.example.org"] },
			{ key: "sk_c", allowedHosts: ["only.test"] },
		]);
	});
	it("returns nothing for an unset value", () => {
		assert.deepEqual(parseKeysFromEnv(undefined), []);
	});
	it("looks a key up without leaking whether one of a similar length exists", () => {
		const registry = new KeyRegistry([{ key: "sk_a" }, { key: "sk_bbbbbbbb" }]);
		assert.equal(registry.lookup("sk_a")?.key, "sk_a");
		assert.equal(registry.lookup("sk_"), null);
		assert.equal(registry.lookup(undefined), null);
	});
});
