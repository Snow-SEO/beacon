import { ipInAnyCidr, type ParsedCidr, parseCidr } from "./cidr-match.js";
import { httpFetch } from "./http.js";

const PROVIDER_RANGE_SOURCES: Record<string, readonly string[]> = {
	OpenAI: [
		"https://openai.com/gptbot.json",
		"https://openai.com/searchbot.json",
		"https://openai.com/chatgpt-user.json",
		"https://openai.com/adsbot.json",
		"https://openai.com/chatgpt-agents.json",
		"https://openai.com/chatgpt-connectors.json",
	],
	Google: [
		"https://developers.google.com/static/crawling/ipranges/common-crawlers.json",
		"https://developers.google.com/static/crawling/ipranges/special-crawlers.json",
		"https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers.json",
		"https://developers.google.com/static/crawling/ipranges/user-triggered-fetchers-google.json",
		"https://developers.google.com/static/crawling/ipranges/user-triggered-agents.json",
	],
	Anthropic: ["https://claude.com/crawling/bots.json"],
	Perplexity: [
		"https://www.perplexity.ai/perplexitybot.json",
		"https://www.perplexity.ai/perplexity-user.json",
	],
	Microsoft: ["https://www.bing.com/toolbox/bingbot.json"],
	Apple: ["https://search.developer.apple.com/applebot.json"],
	Mistral: [
		"https://mistral.ai/mistralai-user-ips.json",
		"https://mistral.ai/mistralai-index-ips.json",
	],
	"Moonshot AI": [
		"https://www.kimi.com/policies/kimi-user.json",
		"https://www.kimi.com/policies/kimi-searchbot.json",
		"https://www.kimi.com/policies/kimibot.json",
	],
	DuckDuckGo: ["https://duckduckgo.com/duckassistbot.json"],
	"Common Crawl": ["https://index.commoncrawl.org/ccbot.json"],
};

const PROVIDER_ASN_SOURCES: Record<string, readonly number[]> = {
	Meta: [32934, 63293],
};

const LOW_CONFIDENCE_RANGES = new Set(["Perplexity"]);

export function hasReliableRanges(provider: string): boolean {
	return !LOW_CONFIDENCE_RANGES.has(provider);
}

const asnUrl = (asn: number) =>
	`https://raw.githubusercontent.com/ipverse/asn-ip/master/as/${asn}/aggregated.json`;

interface RangeListJson {
	prefixes?: Array<{
		ipv4Prefix?: string;
		ipv6Prefix?: string;
	}>;
}

interface AsnRangeJson {
	prefixes?: {
		ipv4?: string[];
		ipv6?: string[];
	};
}

const cache = new Map<string, ParsedCidr[]>();

let lastLoadedAt = 0;

let inFlight: Promise<void> | null = null;

const STALE_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 10000;

export function hasPublishedRanges(provider: string): boolean {
	return provider in PROVIDER_RANGE_SOURCES || provider in PROVIDER_ASN_SOURCES;
}

export function hasLoadedRanges(provider: string): boolean {
	return (cache.get(provider)?.length ?? 0) > 0;
}

async function fetchRangeList(url: string): Promise<ParsedCidr[]> {
	const res = await httpFetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`${url} -> HTTP ${res.status}`);
	}
	const json = (await res.json()) as RangeListJson;
	const out: ParsedCidr[] = [];
	for (const entry of json.prefixes ?? []) {
		const raw = entry.ipv4Prefix ?? entry.ipv6Prefix;
		if (!raw) {
			continue;
		}
		const parsed = parseCidr(raw);
		if (parsed) {
			out.push(parsed);
		}
	}
	return out;
}

async function fetchAsnRangeList(asn: number): Promise<ParsedCidr[]> {
	const res = await httpFetch(asnUrl(asn), {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`AS${asn} -> HTTP ${res.status}`);
	}
	const json = (await res.json()) as AsnRangeJson;
	const out: ParsedCidr[] = [];
	for (const raw of [
		...(json.prefixes?.ipv4 ?? []),
		...(json.prefixes?.ipv6 ?? []),
	]) {
		const parsed = parseCidr(raw);
		if (parsed) {
			out.push(parsed);
		}
	}
	return out;
}

export async function refreshCrawlerRanges(): Promise<{
	providers: number;
	cidrs: number;
}> {
	let totalCidrs = 0;
	const providers = new Set([
		...Object.keys(PROVIDER_RANGE_SOURCES),
		...Object.keys(PROVIDER_ASN_SOURCES),
	]);
	for (const provider of providers) {
		try {
			const lists = await Promise.all([
				...(PROVIDER_RANGE_SOURCES[provider] ?? []).map((u) =>
					fetchRangeList(u),
				),
				...(PROVIDER_ASN_SOURCES[provider] ?? []).map((asn) =>
					fetchAsnRangeList(asn),
				),
			]);
			const merged = lists.flat();
			if (merged.length > 0) {
				cache.set(provider, merged);
			}
		} catch (err) {
			console.warn(
				`[crawler-ranges] refresh failed for ${provider}: ${(err as Error).message}`,
			);
		}
		totalCidrs += cache.get(provider)?.length ?? 0;
	}
	lastLoadedAt = Date.now();
	return { providers: cache.size, cidrs: totalCidrs };
}

export function warmCrawlerRangesInBackground(): void {
	if (inFlight) {
		return;
	}
	if (cache.size > 0 && Date.now() - lastLoadedAt < STALE_MS) {
		return;
	}
	inFlight = refreshCrawlerRanges()
		.then(() => undefined)
		.catch((err) => {
			console.warn(
				`[crawler-ranges] background warm failed: ${(err as Error).message}`,
			);
		})
		.finally(() => {
			inFlight = null;
		});
}

export function isIpInProviderRanges(ip: string, provider: string): boolean {
	const cidrs = cache.get(provider);
	return cidrs ? ipInAnyCidr(ip, cidrs) : false;
}

export function findProviderOwningIp(ip: string): string | null {
	for (const [provider, cidrs] of cache.entries()) {
		if (ipInAnyCidr(ip, cidrs)) {
			return provider;
		}
	}
	return null;
}

export function __setProviderRangesForTest(
	provider: string,
	cidrs: ParsedCidr[],
): void {
	cache.set(provider, cidrs);
	lastLoadedAt = Date.now();
}

export function __clearRangesForTest(): void {
	cache.clear();
	lastLoadedAt = 0;
}
