import {
	createHash,
	createPublicKey,
	verify as cryptoVerify,
	type JsonWebKey,
} from "node:crypto";
import { httpFetch } from "./http.js";

const WEB_BOT_AUTH_TAG = "web-bot-auth";

const DIRECTORY_PATH = "/.well-known/http-message-signatures-directory";

const FETCH_TIMEOUT_MS = 5000;

const DIRECTORY_TTL_MS = 60 * 60 * 1000;

const DIRECTORY_FAILURE_TTL_MS = 10 * 60 * 1000;

const MAX_DIRECTORY_BYTES = 128 * 1024;

const MAX_CACHED_DIRECTORIES = 256;

const SKEW_MS = 5 * 60 * 1000;

export type WebBotAuthOutcome =
	| "signed"
	| "invalid_signature"
	| "unsupported"
	| "unavailable";

export interface WebBotAuthResult {
	outcome: WebBotAuthOutcome;
	signatureAgent: string | null;
}

export interface SignedRequestFacts {
	host: string;
	method: string | undefined;
	rawPath: string | undefined;
	signature: string;
	signatureInput: string;
	signatureAgent: string | undefined;
	occurredAt: Date;
}

interface ParsedSignatureInput {
	label: string;
	components: string[];
	paramsText: string;
	keyid: string | null;
	alg: string | null;
	tag: string | null;
	created: number | null;
	expires: number | null;
}

interface CachedDirectory {
	keys: Map<string, JsonWebKey> | null;
	expiresAt: number;
}

const directoryCache = new Map<string, CachedDirectory>();

function splitTopLevel(value: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quoted = false;
	let start = 0;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (quoted) {
			if (ch === "\\") {
				i++;
			} else if (ch === '"') {
				quoted = false;
			}
			continue;
		}
		if (ch === '"') {
			quoted = true;
		} else if (ch === "(") {
			depth++;
		} else if (ch === ")") {
			depth = Math.max(0, depth - 1);
		} else if (ch === "," && depth === 0) {
			out.push(value.slice(start, i));
			start = i + 1;
		}
	}
	out.push(value.slice(start));
	return out.map((s) => s.trim()).filter(Boolean);
}

function readParam(paramsText: string, name: string): string | null {
	const quoted = new RegExp(`;\\s*${name}\\s*=\\s*"([^"]*)"`).exec(paramsText);
	if (quoted) {
		return quoted[1];
	}
	const bare = new RegExp(`;\\s*${name}\\s*=\\s*([^;\\s]+)`).exec(paramsText);
	return bare ? bare[1] : null;
}

function parseSignatureInput(header: string): ParsedSignatureInput[] {
	const parsed: ParsedSignatureInput[] = [];
	for (const entry of splitTopLevel(header)) {
		const eq = entry.indexOf("=");
		const open = entry.indexOf("(");
		const close = entry.indexOf(")", open);
		if (eq === -1 || open === -1 || close === -1 || open < eq) {
			continue;
		}
		const label = entry.slice(0, eq).trim();
		const inner = entry.slice(open + 1, close);
		const paramsText = entry.slice(close + 1);
		const components = inner.match(/"[^"]*"(?:;[^"\s]+)?/g) ?? [];
		const created = readParam(paramsText, "created");
		const expires = readParam(paramsText, "expires");
		parsed.push({
			label,
			components: components.map((c) => c.trim()),
			paramsText,
			keyid: readParam(paramsText, "keyid"),
			alg: readParam(paramsText, "alg"),
			tag: readParam(paramsText, "tag"),
			created: created ? Number(created) : null,
			expires: expires ? Number(expires) : null,
		});
	}
	return parsed;
}

function parseSignature(header: string, label: string): Buffer | null {
	for (const entry of splitTopLevel(header)) {
		const eq = entry.indexOf("=");
		if (eq === -1 || entry.slice(0, eq).trim() !== label) {
			continue;
		}
		const raw = entry.slice(eq + 1).trim();
		if (!(raw.startsWith(":") && raw.endsWith(":") && raw.length > 2)) {
			return null;
		}
		return Buffer.from(raw.slice(1, -1), "base64");
	}
	return null;
}

function componentValue(
	component: string,
	facts: SignedRequestFacts,
	url: URL,
): string | null {
	switch (component) {
		case '"@authority"':
			return facts.host;
		case '"@method"':
			return facts.method?.toUpperCase() ?? null;
		case '"@path"':
			return url.pathname;
		case '"@query"':
			return url.search === "" ? "?" : url.search;
		case '"@scheme"':
			return url.protocol.replace(":", "");
		case '"@target-uri"':
			return url.toString();
		case '"signature-agent"':
			return facts.signatureAgent ?? null;
		default:
			return null;
	}
}

function buildSignatureBase(
	input: ParsedSignatureInput,
	facts: SignedRequestFacts,
	url: URL,
): string | null {
	const lines: string[] = [];
	for (const component of input.components) {
		const value = componentValue(component, facts, url);
		if (value === null) {
			return null;
		}
		lines.push(`${component}: ${value}`);
	}
	const componentList = input.components.join(" ");
	lines.push(`"@signature-params": (${componentList})${input.paramsText}`);
	return lines.join("\n");
}

function jwkThumbprint(jwk: JsonWebKey): string | null {
	if (jwk.kty !== "OKP" || !jwk.x) {
		return null;
	}
	const canonical = JSON.stringify({
		crv: (
			jwk as {
				crv?: string;
			}
		).crv,
		kty: jwk.kty,
		x: jwk.x,
	});
	return createHash("sha256").update(canonical).digest("base64url");
}

const DICTIONARY_MEMBER_RE = /"(https:\/\/[^"]+)"/;

function directoryUrl(signatureAgent: string): string | null {
	const raw = signatureAgent.trim();
	const trimmed = raw.startsWith('"')
		? raw.replace(/^"|"$/g, "")
		: (DICTIONARY_MEMBER_RE.exec(raw)?.[1] ?? raw);
	if (!trimmed.startsWith("https://")) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	if (url.pathname === "" || url.pathname === "/") {
		url.pathname = DIRECTORY_PATH;
	}
	return url.toString();
}

async function loadDirectory(
	url: string,
): Promise<Map<string, JsonWebKey> | null> {
	const cached = directoryCache.get(url);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.keys;
	}
	let keys: Map<string, JsonWebKey> | null = null;
	try {
		const res = await httpFetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (res.ok) {
			const text = (await res.text()).slice(0, MAX_DIRECTORY_BYTES);
			const doc = JSON.parse(text) as
				| {
						keys?: JsonWebKey[];
				  }
				| JsonWebKey[];
			const list = Array.isArray(doc) ? doc : (doc.keys ?? []);
			const map = new Map<string, JsonWebKey>();
			for (const jwk of list) {
				const thumbprint = jwkThumbprint(jwk);
				if (thumbprint) {
					map.set(thumbprint, jwk);
				}
				const kid = (
					jwk as {
						kid?: string;
					}
				).kid;
				if (kid) {
					map.set(kid, jwk);
				}
			}
			keys = map.size > 0 ? map : null;
		}
	} catch {
		keys = null;
	}
	if (directoryCache.size >= MAX_CACHED_DIRECTORIES) {
		directoryCache.clear();
	}
	directoryCache.set(url, {
		keys,
		expiresAt:
			Date.now() + (keys ? DIRECTORY_TTL_MS : DIRECTORY_FAILURE_TTL_MS),
	});
	return keys;
}

export async function verifyWebBotAuth(
	facts: SignedRequestFacts,
): Promise<WebBotAuthResult> {
	const inputs = parseSignatureInput(facts.signatureInput);
	const input =
		inputs.find((i) => i.tag === WEB_BOT_AUTH_TAG) ?? inputs[0] ?? null;
	if (!input || input.components.length === 0) {
		return { outcome: "unsupported", signatureAgent: null };
	}
	if (input.alg && input.alg.toLowerCase() !== "ed25519") {
		return { outcome: "unsupported", signatureAgent: null };
	}
	const at = facts.occurredAt.getTime();
	if (input.expires !== null && at > input.expires * 1000 + SKEW_MS) {
		return { outcome: "invalid_signature", signatureAgent: null };
	}
	if (input.created !== null && at < input.created * 1000 - SKEW_MS) {
		return { outcome: "invalid_signature", signatureAgent: null };
	}
	if (!facts.signatureAgent) {
		return { outcome: "unsupported", signatureAgent: null };
	}
	const dirUrl = directoryUrl(facts.signatureAgent);
	if (!dirUrl) {
		return { outcome: "unsupported", signatureAgent: null };
	}
	const agentHost = new URL(dirUrl).hostname;
	let url: URL;
	try {
		url = new URL(facts.rawPath ?? "/", `https://${facts.host}`);
	} catch {
		return { outcome: "unsupported", signatureAgent: agentHost };
	}
	const base = buildSignatureBase(input, facts, url);
	if (base === null) {
		return { outcome: "unsupported", signatureAgent: agentHost };
	}
	const signatureBytes = parseSignature(facts.signature, input.label);
	if (!signatureBytes) {
		return { outcome: "unsupported", signatureAgent: agentHost };
	}
	const keys = await loadDirectory(dirUrl);
	if (!keys) {
		return { outcome: "unavailable", signatureAgent: agentHost };
	}
	const candidates = input.keyid
		? [keys.get(input.keyid)].filter((k): k is JsonWebKey => Boolean(k))
		: [...new Set(keys.values())];
	if (candidates.length === 0) {
		return { outcome: "invalid_signature", signatureAgent: agentHost };
	}
	for (const jwk of candidates) {
		try {
			const key = createPublicKey({ key: jwk, format: "jwk" });
			if (cryptoVerify(null, Buffer.from(base, "utf8"), key, signatureBytes)) {
				return { outcome: "signed", signatureAgent: agentHost };
			}
		} catch {}
	}
	return { outcome: "invalid_signature", signatureAgent: agentHost };
}

export function __setDirectoryForTest(
	signatureAgent: string,
	jwks: readonly JsonWebKey[],
): void {
	const url = directoryUrl(signatureAgent);
	if (!url) {
		throw new Error(`unusable Signature-Agent for test: ${signatureAgent}`);
	}
	const map = new Map<string, JsonWebKey>();
	for (const jwk of jwks) {
		const thumbprint = jwkThumbprint(jwk);
		if (thumbprint) {
			map.set(thumbprint, jwk);
		}
	}
	directoryCache.set(url, { keys: map, expiresAt: Date.now() + 60000 });
}

export const __jwkThumbprintForTest = jwkThumbprint;

export function __clearDirectoryCacheForTest(): void {
	directoryCache.clear();
}
