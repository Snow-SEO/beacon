export const BEACON_KEY_HEADER = "x-beacon-key";

export const BEACON_INGEST_PATH = "/v3/beacon/hits";

export const MAX_HITS_PER_REQUEST = 500;

export const MAX_HOST_LENGTH = 255;

export const MAX_PATH_LENGTH = 2048;

export const MAX_UA_LENGTH = 512;

export interface IncomingHit {
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
	headers?: Record<string, string>;
}

export interface IngestRequestBody {
	host: string;
	hits: IncomingHit[];
}

export interface IngestResponseBody {
	accepted: number;
	skipped: number;
	reasons: {
		malformed: number;
		unrecognized: number;
	};
}

export type BeaconErrorCode =
	| "BEACON_HOST_NOT_ALLOWED"
	| "PLAN_INACTIVE"
	| "BAD_REQUEST"
	| "PAYLOAD_TOO_LARGE"
	| "UNAUTHORIZED"
	| "RATE_LIMITED"
	| "INTERNAL_ERROR";

export interface BeaconErrorBody {
	error: string;
	code: BeaconErrorCode;
}

export function isWellFormedHit(hit: IncomingHit): boolean {
	return (
		typeof hit.path === "string" &&
		hit.path.length > 0 &&
		typeof hit.userAgent === "string" &&
		hit.userAgent.length > 0
	);
}

export function validateIngestBody(value: unknown): string | null {
	if (typeof value !== "object" || value === null) {
		return "body must be a JSON object";
	}
	const body = value as Partial<IngestRequestBody>;
	if (typeof body.host !== "string" || body.host.length === 0) {
		return "`host` must be a non-empty string";
	}
	if (body.host.length > MAX_HOST_LENGTH) {
		return `\`host\` exceeds ${MAX_HOST_LENGTH} characters`;
	}
	if (!Array.isArray(body.hits) || body.hits.length === 0) {
		return "`hits` must be a non-empty array";
	}
	if (body.hits.length > MAX_HITS_PER_REQUEST) {
		return `\`hits\` exceeds ${MAX_HITS_PER_REQUEST} items`;
	}
	return null;
}

export function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

export function utcDate(d: Date): string {
	return d.toISOString().slice(0, 10);
}

const MAX_CLOCK_DRIFT_MS = 24 * 60 * 60 * 1000;

export function parseOccurredAt(
	raw: string | undefined,
	now = Date.now(),
): Date {
	if (!raw) {
		return new Date(now);
	}
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) {
		return new Date(now);
	}
	return Math.abs(parsed.getTime() - now) > MAX_CLOCK_DRIFT_MS
		? new Date(now)
		: parsed;
}

const SCHEME_RE = /^https?:\/\//;

const PATH_RE = /\/.*$/;

const PORT_RE = /:\d+$/;

const WWW_RE = /^www\./;

const WILDCARD_RE = /^\*\./;

export function normalizeHost(host: string): string {
	return host
		.trim()
		.toLowerCase()
		.replace(SCHEME_RE, "")
		.replace(PATH_RE, "")
		.replace(PORT_RE, "")
		.replace(WWW_RE, "");
}

export function hostMatchesAllowList(
	host: string,
	allowed: readonly string[],
): boolean {
	return allowed.some((raw) => {
		const pattern = normalizeHost(raw.replace(WILDCARD_RE, ""));
		if (raw.trimStart().startsWith("*.")) {
			return host === pattern || host.endsWith(`.${pattern}`);
		}
		return host === pattern;
	});
}
