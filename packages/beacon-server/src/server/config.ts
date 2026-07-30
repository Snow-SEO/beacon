import type { IpMode } from "../ip-privacy.js";
import { MemoryHitStore } from "../store/memory.js";
import { PostgresHitStore } from "../store/postgres.js";
import { SqliteHitStore } from "../store/sqlite.js";
import type { HitStore } from "../store/types.js";
import type { BeaconServerOptions } from "./app.js";
import { parseKeysFromEnv } from "./auth.js";

export type StoreKind = "sqlite" | "postgres" | "memory";

const DEFAULT_PORT = 8787;

function intFromEnv(raw: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(raw ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function createStoreFromEnv(env: NodeJS.ProcessEnv): HitStore {
	const kind = (env.BEACON_STORE ?? "sqlite").toLowerCase() as StoreKind;
	if (kind === "memory") {
		return new MemoryHitStore();
	}
	if (kind === "postgres") {
		const connectionString = env.BEACON_POSTGRES_URL ?? env.DATABASE_URL;
		if (!connectionString) {
			throw new Error(
				"BEACON_STORE=postgres needs BEACON_POSTGRES_URL (or DATABASE_URL)",
			);
		}
		return new PostgresHitStore({ connectionString });
	}
	if (kind !== "sqlite") {
		throw new Error(
			`Unknown BEACON_STORE "${env.BEACON_STORE}"; expected sqlite, postgres or memory`,
		);
	}
	return new SqliteHitStore({ path: env.BEACON_SQLITE_PATH ?? "beacon.db" });
}

export function configFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): BeaconServerOptions & {
	port: number;
	host: string;
} {
	const keys = parseKeysFromEnv(env.BEACON_KEYS ?? env.BEACON_KEY);
	if (keys.length === 0) {
		throw new Error(
			"Set BEACON_KEYS to one or more ingest keys, e.g. BEACON_KEYS=sk_local_dev or sk_local_dev@example.com",
		);
	}
	return {
		store: createStoreFromEnv(env),
		keys,
		ipMode: (env.BEACON_IP_MODE ?? "hash") as IpMode,
		ipSalt: env.BEACON_IP_SALT,
		maxBodyBytes: env.BEACON_MAX_BODY_BYTES
			? intFromEnv(env.BEACON_MAX_BODY_BYTES, 0) || undefined
			: undefined,
		port: intFromEnv(env.PORT, DEFAULT_PORT),
		host: env.HOST ?? "0.0.0.0",
		log: (message, meta) => {
			console.log(
				JSON.stringify({ level: "info", msg: `[beacon] ${message}`, ...meta }),
			);
		},
	};
}
