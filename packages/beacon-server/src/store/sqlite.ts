import type { VerifyMethod, VerifyState } from "../ip-verify.js";
import type {
	DailyRollup,
	HitStore,
	StoredHit,
	VerdictUpdate,
} from "./types.js";

interface SqliteStatement {
	run(...params: unknown[]): unknown;
	get(...params: unknown[]): Record<string, unknown> | undefined;
	all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beacon_hits (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  provider TEXT NOT NULL,
  agent TEXT NOT NULL,
  category TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  format TEXT,
  status_code INTEGER,
  referrer TEXT,
  ip TEXT,
  user_agent TEXT NOT NULL,
  verified INTEGER NOT NULL,
  verify_method TEXT,
  verify_state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS beacon_hits_occurred_at_idx ON beacon_hits (occurred_at);
CREATE INDEX IF NOT EXISTS beacon_hits_host_idx ON beacon_hits (host, occurred_at);

CREATE TABLE IF NOT EXISTS beacon_daily_stats (
  date TEXT NOT NULL,
  agent TEXT NOT NULL,
  provider TEXT NOT NULL,
  category TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  markdown_hits INTEGER NOT NULL DEFAULT 0,
  html_hits INTEGER NOT NULL DEFAULT 0,
  verified_hits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, agent)
);
`;

const INSERT_HIT = `
INSERT OR REPLACE INTO beacon_hits (
  id, occurred_at, provider, agent, category, host, path, format,
  status_code, referrer, ip, user_agent, verified, verify_method, verify_state
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_ROLLUP = `
INSERT INTO beacon_daily_stats (
  date, agent, provider, category, hits, markdown_hits, html_hits, verified_hits
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT (date, agent) DO UPDATE SET
  hits = hits + excluded.hits,
  markdown_hits = markdown_hits + excluded.markdown_hits,
  html_hits = html_hits + excluded.html_hits,
  verified_hits = verified_hits + excluded.verified_hits`;

export interface SqliteHitStoreOptions {
	path?: string;
}

export class SqliteHitStore implements HitStore {
	private db: SqliteDatabase | null = null;
	private readonly path: string;
	constructor(options: SqliteHitStoreOptions = {}) {
		this.path = options.path ?? "beacon.db";
	}
	async init(): Promise<void> {
		const specifier = "node:sqlite";
		let DatabaseSync: new (path: string) => SqliteDatabase;
		try {
			({ DatabaseSync } = await import(specifier));
		} catch (err) {
			throw new Error(
				`node:sqlite is unavailable (${(err as Error).message}). Use Node 24+, or Node 22.5+ with --experimental-sqlite, or configure the Postgres store.`,
			);
		}
		this.db = new DatabaseSync(this.path);
		this.db.exec("PRAGMA journal_mode = WAL");
		this.db.exec("PRAGMA busy_timeout = 5000");
		this.db.exec(SCHEMA);
	}
	private require(): SqliteDatabase {
		if (!this.db) {
			throw new Error("SqliteHitStore.init() has not been called");
		}
		return this.db;
	}
	save(
		hits: readonly StoredHit[],
		rollups: readonly DailyRollup[],
	): Promise<void> {
		const db = this.require();
		const insertHit = db.prepare(INSERT_HIT);
		const upsertRollup = db.prepare(UPSERT_ROLLUP);
		db.exec("BEGIN");
		try {
			for (const hit of hits) {
				insertHit.run(
					hit.id,
					hit.occurredAt.toISOString(),
					hit.provider,
					hit.agent,
					hit.category,
					hit.host,
					hit.path,
					hit.format,
					hit.statusCode,
					hit.referrer,
					hit.ip,
					hit.userAgent,
					hit.verified ? 1 : 0,
					hit.verifyMethod,
					hit.verifyState,
				);
			}
			for (const entry of rollups) {
				upsertRollup.run(
					entry.date,
					entry.agent,
					entry.provider,
					entry.category,
					entry.hits,
					entry.markdownHits,
					entry.htmlHits,
					entry.verifiedHits,
				);
			}
			db.exec("COMMIT");
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
		return Promise.resolve();
	}
	applyVerdicts(updates: readonly VerdictUpdate[]): Promise<void> {
		const db = this.require();
		const readVerified = db.prepare(
			"SELECT verified FROM beacon_hits WHERE id = ?",
		);
		const updateHit = db.prepare(
			"UPDATE beacon_hits SET verified = ?, verify_method = ?, verify_state = ? WHERE id = ?",
		);
		const bumpRollup = db.prepare(
			"UPDATE beacon_daily_stats SET verified_hits = verified_hits + 1 WHERE date = ? AND agent = ?",
		);
		db.exec("BEGIN");
		try {
			for (const update of updates) {
				const row = readVerified.get(update.id);
				if (!row) {
					continue;
				}
				const wasVerified = Number(row.verified) === 1;
				updateHit.run(
					update.verified ? 1 : 0,
					update.verifyMethod,
					update.verifyState,
					update.id,
				);
				if (update.verified && !wasVerified) {
					bumpRollup.run(update.date, update.agent);
				}
			}
			db.exec("COMMIT");
		} catch (err) {
			db.exec("ROLLBACK");
			throw err;
		}
		return Promise.resolve();
	}
	listDailyStats(options: { from?: string; to?: string } = {}): DailyRollup[] {
		const rows = this.require()
			.prepare(`SELECT date, agent, provider, category, hits, markdown_hits, html_hits, verified_hits
         FROM beacon_daily_stats
         WHERE date >= ? AND date <= ?
         ORDER BY date DESC, hits DESC`)
			.all(options.from ?? "0000-01-01", options.to ?? "9999-12-31");
		return rows.map((row) => ({
			date: String(row.date),
			agent: String(row.agent),
			provider: String(row.provider),
			category: String(row.category),
			hits: Number(row.hits),
			markdownHits: Number(row.markdown_hits),
			htmlHits: Number(row.html_hits),
			verifiedHits: Number(row.verified_hits),
		}));
	}
	listHits(limit = 100): StoredHit[] {
		const rows = this.require()
			.prepare("SELECT * FROM beacon_hits ORDER BY occurred_at DESC LIMIT ?")
			.all(limit);
		return rows.map((row) => ({
			id: String(row.id),
			occurredAt: new Date(String(row.occurred_at)),
			provider: String(row.provider),
			agent: String(row.agent),
			category: String(row.category),
			host: String(row.host),
			path: String(row.path),
			format: (row.format ?? null) as StoredHit["format"],
			statusCode: row.status_code === null ? null : Number(row.status_code),
			referrer: row.referrer === null ? null : String(row.referrer),
			ip: row.ip === null ? null : String(row.ip),
			userAgent: String(row.user_agent),
			verified: Number(row.verified) === 1,
			verifyMethod: (row.verify_method ?? null) as VerifyMethod | null,
			verifyState: String(row.verify_state) as VerifyState,
		}));
	}
	close(): Promise<void> {
		this.db?.close();
		this.db = null;
		return Promise.resolve();
	}
}
