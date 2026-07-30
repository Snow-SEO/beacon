import {
	type AICrawlerCategory,
	type AICrawlerMatch,
	classifyAICrawler,
} from "./crawlers.js";

export const INGEST_PATH = "/v3/beacon/hits";

export const DEFAULT_INGEST_ENDPOINT = `https://api.snowseo.com${INGEST_PATH}`;

const DEFAULT_BATCH_SIZE = 25;

const DEFAULT_FLUSH_INTERVAL_MS = 5000;

const DEFAULT_TIMEOUT_MS = 2000;

const MAX_BUFFER = 500;

export function normalizeIngestEndpoint(endpoint: string): string {
	let url: URL;
	try {
		url = new URL(endpoint);
	} catch {
		return endpoint;
	}
	if (url.pathname === "" || url.pathname === "/") {
		url.pathname = INGEST_PATH;
	}
	return url.toString();
}

export interface BeaconHit {
	path: string;
	userAgent: string;
	format?: "markdown" | "html";
	statusCode?: number;
	referrer?: string;
	ip?: string;
	occurredAt?: string;
	askedForMarkdown?: boolean;
	fromBrowser?: boolean;
	method?: string;
	rawPath?: string;
	signature?: string;
	signatureInput?: string;
	signatureAgent?: string;
}

export interface AnalyticsConfig {
	key: string;
	host: string;
	endpoint?: string;
	batchSize?: number;
	flushIntervalMs?: number;
	timeoutMs?: number;
	fetch?: typeof fetch;
	onError?: (error: unknown) => void;
	disableCategories?: readonly AICrawlerCategory[];
	onHit?: (hit: BeaconHit, match: AICrawlerMatch) => void;
}

export interface WaitUntilContext {
	waitUntil?: (promise: Promise<unknown>) => void;
}

const warned = new Set<string>();

function warnOnce(error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (warned.has(message)) {
		return;
	}
	warned.add(message);
	console.warn(
		message.startsWith("[beacon]") ? message : `[beacon] ${message}`,
	);
}

const AUTOMATION_MARKERS = [
	"bot",
	"crawl",
	"spider",
	"scrape",
	"fetch",
	"+http",
	"agent",
	"curl/",
	"wget",
	"python-requests",
	"httpx",
	"aiohttp",
	"axios",
	"node-fetch",
	"undici",
	"okhttp",
	"go-http-client",
	"java/",
	"libwww",
	"headlesschrome",
] as const;

function looksAutomated(userAgent: string | undefined): boolean {
	if (!userAgent) {
		return false;
	}
	const ua = userAgent.toLowerCase();
	return AUTOMATION_MARKERS.some((marker) => ua.includes(marker));
}

export class BeaconAnalytics {
	private readonly config: Required<
		Omit<AnalyticsConfig, "onError" | "fetch" | "onHit" | "disableCategories">
	> & {
		onError?: (error: unknown) => void;
		onHit?: (hit: BeaconHit, match: AICrawlerMatch) => void;
		fetch: typeof fetch;
	};
	private readonly disabled: ReadonlySet<AICrawlerCategory>;
	private buffer: BeaconHit[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;
	constructor(config: AnalyticsConfig) {
		this.config = {
			key: config.key,
			host: config.host,
			endpoint: config.endpoint
				? normalizeIngestEndpoint(config.endpoint)
				: DEFAULT_INGEST_ENDPOINT,
			batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
			flushIntervalMs: config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
			timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
			fetch: config.fetch ?? globalThis.fetch,
			onError: config.onError ?? warnOnce,
			onHit: config.onHit,
		};
		this.disabled = new Set(config.disableCategories ?? []);
	}
	record(hit: BeaconHit, ctx?: WaitUntilContext): void {
		const match = classifyAICrawler(hit.userAgent);
		if (
			!(
				match ||
				hit.askedForMarkdown ||
				!hit.fromBrowser ||
				looksAutomated(hit.userAgent)
			)
		) {
			return;
		}
		if (match) {
			this.config.onHit?.(hit, match);
			if (this.disabled.has(match.category)) {
				return;
			}
		}
		if (this.buffer.length >= MAX_BUFFER) {
			this.buffer.shift();
		}
		this.buffer.push({ occurredAt: new Date().toISOString(), ...hit });
		if (this.buffer.length >= this.config.batchSize) {
			this.flush(ctx);
			return;
		}
		this.scheduleFlush(ctx);
	}
	private scheduleFlush(ctx?: WaitUntilContext): void {
		if (this.timer !== null) {
			return;
		}
		this.timer = setTimeout(() => {
			this.timer = null;
			this.flush(ctx);
		}, this.config.flushIntervalMs);
		(
			this.timer as {
				unref?: () => void;
			}
		).unref?.();
	}
	flush(ctx?: WaitUntilContext): void {
		if (this.buffer.length === 0) {
			return;
		}
		const hits = this.buffer;
		this.buffer = [];
		if (this.timer !== null) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		const promise = this.send(hits);
		if (ctx?.waitUntil) {
			ctx.waitUntil(promise);
		}
	}
	private async send(hits: BeaconHit[]): Promise<void> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
		try {
			const response = await this.config.fetch(this.config.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Beacon-Key": this.config.key,
				},
				body: JSON.stringify({ host: this.config.host, hits }),
				signal: controller.signal,
				keepalive: true,
			});
			if (!response.ok) {
				this.config.onError?.(
					new Error(
						`[beacon] ingest rejected ${hits.length} hit(s): ${response.status} ${response.statusText} from ${this.config.endpoint}`,
					),
				);
			}
		} catch (error) {
			this.config.onError?.(error);
		} finally {
			clearTimeout(timer);
		}
	}
}
