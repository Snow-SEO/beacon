import type {
	DailyRollup,
	HitStore,
	StoredHit,
	VerdictUpdate,
} from "./types.js";

interface PgQueryResult {
	rows: Record<string, unknown>[];
}

interface PgClient {
	query(text: string, values?: unknown[]): Promise<PgQueryResult>;
	release(): void;
}

interface PgPool {
	connect(): Promise<PgClient>;
	query(text: string, values?: unknown[]): Promise<PgQueryResult>;
	end(): Promise<void>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beacon_hits (
  id UUID PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
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
  verified BOOLEAN NOT NULL,
  verify_method TEXT,
  verify_state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS beacon_hits_occurred_at_idx ON beacon_hits (occurred_at DESC);
CREATE INDEX IF NOT EXISTS beacon_hits_host_idx ON beacon_hits (host, occurred_at DESC);

CREATE TABLE IF NOT EXISTS beacon_daily_stats (
  date DATE NOT NULL,
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

const HIT_COLUMNS = 15;

const INSERT_CHUNK = 200;

export interface PostgresHitStoreOptions {
	connectionString: string;
	migrate?: boolean;
}

export class PostgresHitStore implements HitStore {
	private pool: PgPool | null = null;
	private readonly options: PostgresHitStoreOptions;
	constructor(options: PostgresHitStoreOptions) {
		this.options = options;
	}
	async init(): Promise<void> {
		const specifier = "pg";
		let Pool: new (config: { connectionString: string }) => PgPool;
		try {
			const mod = await import(specifier);
			Pool = (mod.default?.Pool ?? mod.Pool) as typeof Pool;
		} catch (err) {
			throw new Error(
				`The Postgres store needs the \`pg\` package: npm install pg (${(err as Error).message})`,
			);
		}
		this.pool = new Pool({ connectionString: this.options.connectionString });
		if (this.options.migrate !== false) {
			await this.pool.query(SCHEMA);
		}
	}
	private require(): PgPool {
		if (!this.pool) {
			throw new Error("PostgresHitStore.init() has not been called");
		}
		return this.pool;
	}
	async save(
		hits: readonly StoredHit[],
		rollups: readonly DailyRollup[],
	): Promise<void> {
		const client = await this.require().connect();
		try {
			await client.query("BEGIN");
			for (let i = 0; i < hits.length; i += INSERT_CHUNK) {
				const chunk = hits.slice(i, i + INSERT_CHUNK);
				const values: unknown[] = [];
				const tuples = chunk.map((hit, row) => {
					values.push(
						hit.id,
						hit.occurredAt,
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
						hit.verified,
						hit.verifyMethod,
						hit.verifyState,
					);
					const base = row * HIT_COLUMNS;
					const placeholders = Array.from(
						{ length: HIT_COLUMNS },
						(_, col) => `$${base + col + 1}`,
					);
					return `(${placeholders.join(", ")})`;
				});
				await client.query(
					`INSERT INTO beacon_hits (
             id, occurred_at, provider, agent, category, host, path, format,
             status_code, referrer, ip, user_agent, verified, verify_method, verify_state
           ) VALUES ${tuples.join(", ")}
           ON CONFLICT (id) DO NOTHING`,
					values,
				);
			}
			for (const entry of rollups) {
				await client.query(
					`INSERT INTO beacon_daily_stats (
             date, agent, provider, category, hits, markdown_hits, html_hits, verified_hits
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (date, agent) DO UPDATE SET
             hits = beacon_daily_stats.hits + EXCLUDED.hits,
             markdown_hits = beacon_daily_stats.markdown_hits + EXCLUDED.markdown_hits,
             html_hits = beacon_daily_stats.html_hits + EXCLUDED.html_hits,
             verified_hits = beacon_daily_stats.verified_hits + EXCLUDED.verified_hits`,
					[
						entry.date,
						entry.agent,
						entry.provider,
						entry.category,
						entry.hits,
						entry.markdownHits,
						entry.htmlHits,
						entry.verifiedHits,
					],
				);
			}
			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw err;
		} finally {
			client.release();
		}
	}
	async applyVerdicts(updates: readonly VerdictUpdate[]): Promise<void> {
		const client = await this.require().connect();
		try {
			await client.query("BEGIN");
			for (const update of updates) {
				const result = await client.query(
					`WITH prev AS (
             SELECT id, verified FROM beacon_hits WHERE id = $4 FOR UPDATE
           )
           UPDATE beacon_hits h
              SET verified = $1, verify_method = $2, verify_state = $3
             FROM prev
            WHERE h.id = prev.id
           RETURNING prev.verified AS was_verified`,
					[update.verified, update.verifyMethod, update.verifyState, update.id],
				);
				const wasVerified = result.rows[0]?.was_verified === true;
				if (update.verified && !wasVerified && result.rows.length > 0) {
					await client.query(
						`UPDATE beacon_daily_stats
               SET verified_hits = verified_hits + 1
             WHERE date = $1 AND agent = $2`,
						[update.date, update.agent],
					);
				}
			}
			await client.query("COMMIT");
		} catch (err) {
			await client.query("ROLLBACK").catch(() => undefined);
			throw err;
		} finally {
			client.release();
		}
	}
	async close(): Promise<void> {
		await this.pool?.end();
		this.pool = null;
	}
}
