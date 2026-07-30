import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SqliteHitStore } from "../src/store/sqlite.js";
import type { DailyRollup, StoredHit } from "../src/store/types.js";

const DATE = "2026-07-30";

function hit(id: string, overrides: Partial<StoredHit> = {}): StoredHit {
	return {
		id,
		occurredAt: new Date(`${DATE}T10:00:00.000Z`),
		provider: "OpenAI",
		agent: "GPTBot",
		category: "training",
		host: "example.com",
		path: "/pricing",
		format: "html",
		statusCode: 200,
		referrer: null,
		ip: "abc123",
		userAgent: "GPTBot/1.2",
		verified: false,
		verifyMethod: null,
		verifyState: "unverified",
		...overrides,
	};
}

function rollup(overrides: Partial<DailyRollup> = {}): DailyRollup {
	return {
		date: DATE,
		agent: "GPTBot",
		provider: "OpenAI",
		category: "training",
		hits: 1,
		markdownHits: 0,
		htmlHits: 1,
		verifiedHits: 0,
		...overrides,
	};
}
describe("SqliteHitStore", () => {
	const store = new SqliteHitStore({ path: ":memory:" });
	before(async () => {
		await store.init();
	});
	after(async () => {
		await store.close();
	});
	it("persists hits and their rollup", async () => {
		await store.save([hit("11111111-1111-4111-8111-111111111111")], [rollup()]);
		const rows = store.listHits();
		assert.equal(rows.length, 1);
		assert.equal(rows[0].provider, "OpenAI");
		assert.equal(rows[0].verified, false);
		assert.equal(rows[0].occurredAt.toISOString(), `${DATE}T10:00:00.000Z`);
		const stats = store.listDailyStats();
		assert.equal(stats.length, 1);
		assert.equal(stats[0].hits, 1);
		assert.equal(stats[0].htmlHits, 1);
	});
	it("accumulates a second batch into the same daily row", async () => {
		await store.save(
			[hit("22222222-2222-4222-8222-222222222222")],
			[rollup({ hits: 2, htmlHits: 1, markdownHits: 1, verifiedHits: 1 })],
		);
		const [stats] = store.listDailyStats();
		assert.equal(stats.hits, 3);
		assert.equal(stats.markdownHits, 1);
		assert.equal(stats.verifiedHits, 1);
	});
	it("backfills a deferred verdict and bumps verifiedHits once", async () => {
		const id = "22222222-2222-4222-8222-222222222222";
		const before = store.listDailyStats()[0].verifiedHits;
		await store.applyVerdicts([
			{
				id,
				date: DATE,
				agent: "GPTBot",
				verified: true,
				verifyMethod: "reverse_dns",
				verifyState: "verified",
			},
		]);
		assert.equal(store.listDailyStats()[0].verifiedHits, before + 1);
		await store.applyVerdicts([
			{
				id,
				date: DATE,
				agent: "GPTBot",
				verified: true,
				verifyMethod: "reverse_dns",
				verifyState: "verified",
			},
		]);
		assert.equal(store.listDailyStats()[0].verifiedHits, before + 1);
		const row = store.listHits().find((h) => h.id === id);
		assert.equal(row?.verifyState, "verified");
		assert.equal(row?.verifyMethod, "reverse_dns");
	});
	it("records a contradicted verdict without touching verifiedHits", async () => {
		const id = "33333333-3333-4333-8333-333333333333";
		await store.save([hit(id)], [rollup()]);
		const before = store.listDailyStats()[0].verifiedHits;
		await store.applyVerdicts([
			{
				id,
				date: DATE,
				agent: "GPTBot",
				verified: false,
				verifyMethod: "reverse_dns",
				verifyState: "spoofed_suspected",
			},
		]);
		assert.equal(store.listDailyStats()[0].verifiedHits, before);
		const row = store.listHits().find((h) => h.id === id);
		assert.equal(row?.verifyState, "spoofed_suspected");
	});
	it("ignores a verdict for an unknown hit", async () => {
		await store.applyVerdicts([
			{
				id: "99999999-9999-4999-8999-999999999999",
				date: DATE,
				agent: "GPTBot",
				verified: true,
				verifyMethod: "reverse_dns",
				verifyState: "verified",
			},
		]);
		assert.equal(store.listHits().length, 3);
	});
});
