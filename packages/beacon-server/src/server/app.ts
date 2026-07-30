import type { Server } from "node:http";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { warmCrawlerRangesInBackground } from "../crawler-ranges.js";
import { warmDatacenterRangesInBackground } from "../datacenter-ranges.js";
import { runDeferredVerification } from "../deferred-verify.js";
import { ingestBatch } from "../ingest.js";
import { createIpTransform, type IpMode } from "../ip-privacy.js";
import {
	BEACON_INGEST_PATH,
	BEACON_KEY_HEADER,
	type BeaconErrorCode,
	hostMatchesAllowList,
	type IngestRequestBody,
	normalizeHost,
	validateIngestBody,
} from "../protocol.js";
import type { HitStore } from "../store/types.js";
import { type BeaconKey, KeyRegistry } from "./auth.js";

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface BeaconServerOptions {
	store: HitStore;
	keys: readonly BeaconKey[];
	ipMode?: IpMode;
	ipSalt?: string;
	maxBodyBytes?: number;
	ingestPath?: string;
	deferredConcurrency?: number;
	warmRanges?: boolean;
	log?: (message: string, meta?: Record<string, unknown>) => void;
}

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const declared = Number(req.headers["content-length"]);
		if (Number.isFinite(declared) && declared > limit) {
			reject(new BodyTooLarge(`body exceeds ${limit} bytes`));
			return;
		}
		const chunks: Buffer[] = [];
		let size = 0;
		const onData = (chunk: Buffer): void => {
			size += chunk.length;
			if (size > limit) {
				req.off("data", onData);
				req.pause();
				reject(new BodyTooLarge(`body exceeds ${limit} bytes`));
				return;
			}
			chunks.push(chunk);
		};
		req.on("data", onData);
		req.on("end", () => resolve(Buffer.concat(chunks)));
		req.on("error", reject);
	});
}

function sendJson(
	res: ServerResponse,
	status: number,
	body: unknown,
	extraHeaders: Record<string, string> = {},
): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(payload),
		"cache-control": "no-store",
		...extraHeaders,
	});
	res.end(payload);
}

function sendError(
	res: ServerResponse,
	status: number,
	code: BeaconErrorCode,
	error: string,
	extraHeaders?: Record<string, string>,
): void {
	sendJson(res, status, { error, code }, extraHeaders);
}

export function createBeaconServer(options: BeaconServerOptions): Server {
	const {
		store,
		ipMode = "hash",
		ipSalt,
		maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
		ingestPath = BEACON_INGEST_PATH,
		deferredConcurrency,
		warmRanges = true,
		log = () => undefined,
	} = options;
	const registry = new KeyRegistry(options.keys);
	if (registry.size === 0) {
		throw new Error(
			"No beacon keys configured. Set BEACON_KEYS, or pass `keys` - starting with none would accept nothing.",
		);
	}
	const transformIp = createIpTransform(ipMode, ipSalt);
	if (warmRanges) {
		warmCrawlerRangesInBackground();
		warmDatacenterRangesInBackground();
	}
	const handleIngest = async (
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> => {
		const presented = req.headers[BEACON_KEY_HEADER];
		const key = registry.lookup(
			Array.isArray(presented) ? presented[0] : presented,
		);
		if (!key) {
			sendError(res, 401, "UNAUTHORIZED", "Missing or unknown beacon key");
			return;
		}
		let raw: Buffer;
		try {
			raw = await readBody(req, maxBodyBytes);
		} catch (err) {
			if (err instanceof BodyTooLarge) {
				res.on("finish", () => req.destroy());
				sendError(res, 413, "PAYLOAD_TOO_LARGE", err.message, {
					connection: "close",
				});
				return;
			}
			throw err;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw.toString("utf8"));
		} catch {
			sendError(res, 400, "BAD_REQUEST", "Body is not valid JSON");
			return;
		}
		const invalid = validateIngestBody(parsed);
		if (invalid) {
			sendError(res, 400, "BAD_REQUEST", invalid);
			return;
		}
		const { host, hits } = parsed as IngestRequestBody;
		if (
			key.allowedHosts &&
			!hostMatchesAllowList(normalizeHost(host), key.allowedHosts)
		) {
			sendError(
				res,
				403,
				"BEACON_HOST_NOT_ALLOWED",
				`This key may not report for ${host}`,
			);
			return;
		}
		warmCrawlerRangesInBackground();
		warmDatacenterRangesInBackground();
		const result = await ingestBatch(host, hits, { transformIp });
		if (result.rows.length > 0) {
			await store.save(result.rows, result.rollups);
		}
		sendJson(res, 200, {
			accepted: result.accepted,
			skipped: result.skipped,
			reasons: result.reasons,
		});
		if (result.reasons.malformed > 0 || result.reasons.unrecognized > 0) {
			log("hits skipped at ingest", {
				host,
				accepted: result.accepted,
				...result.reasons,
				droppedAgents: result.droppedAgents,
			});
		}
		if (result.deferred.length > 0) {
			await runDeferredVerification(result.deferred, store, {
				concurrency: deferredConcurrency,
			}).catch((err: Error) => {
				log("deferred verification failed", { error: err.message });
			});
		}
	};
	return createServer((req, res) => {
		const path = (req.url ?? "/").split("?")[0];
		if (req.method === "GET" && path === "/health") {
			sendJson(res, 200, { status: "ok" });
			return;
		}
		if (path !== ingestPath) {
			sendError(res, 404, "BAD_REQUEST", "Not found");
			return;
		}
		if (req.method !== "POST") {
			res.setHeader("allow", "POST");
			sendError(res, 405, "BAD_REQUEST", "Method not allowed");
			return;
		}
		handleIngest(req, res).catch((err: Error) => {
			log("ingest failed", { error: err.message });
			if (res.headersSent) {
				res.end();
			} else {
				sendError(res, 500, "INTERNAL_ERROR", "Internal error");
			}
		});
	});
}

export interface StartedBeaconServer {
	server: Server;
	port: number;
	close(): Promise<void>;
}

export async function startBeaconServer(
	options: BeaconServerOptions & {
		port?: number;
		host?: string;
	},
): Promise<StartedBeaconServer> {
	await options.store.init?.();
	const server = createBeaconServer(options);
	const port = options.port ?? 8787;
	await new Promise<void>((resolve) => {
		server.listen(port, options.host ?? "0.0.0.0", resolve);
	});
	const address = server.address();
	return {
		server,
		port: typeof address === "object" && address ? address.port : port,
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()));
			});
			await options.store.close?.();
		},
	};
}
