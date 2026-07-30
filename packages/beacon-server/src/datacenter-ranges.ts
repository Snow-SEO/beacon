import {
	ipToBigInt,
	type ParsedCidr,
	parseCidr,
	parsedIpInCidr,
} from "./cidr-match.js";
import { httpFetch } from "./http.js";

interface CloudFeed {
	name: string;
	url: string;
	extract: (json: unknown) => string[];
}

const CLOUD_FEEDS: readonly CloudFeed[] = [
	{
		name: "AWS",
		url: "https://ip-ranges.amazonaws.com/ip-ranges.json",
		extract: (json) => {
			const doc = json as {
				prefixes?: {
					ip_prefix?: string;
				}[];
				ipv6_prefixes?: {
					ipv6_prefix?: string;
				}[];
			};
			return [
				...(doc.prefixes ?? []).map((p) => p.ip_prefix),
				...(doc.ipv6_prefixes ?? []).map((p) => p.ipv6_prefix),
			].filter((v): v is string => typeof v === "string");
		},
	},
	{
		name: "Google Cloud",
		url: "https://www.gstatic.com/ipranges/cloud.json",
		extract: (json) => {
			const doc = json as {
				prefixes?: {
					ipv4Prefix?: string;
					ipv6Prefix?: string;
				}[];
			};
			return (doc.prefixes ?? [])
				.map((p) => p.ipv4Prefix ?? p.ipv6Prefix)
				.filter((v): v is string => typeof v === "string");
		},
	},
];

const HOSTING_ASNS: readonly {
	asn: number;
	name: string;
}[] = [
	{ asn: 8075, name: "Microsoft Azure" },
	{ asn: 31898, name: "Oracle Cloud" },
	{ asn: 136907, name: "Huawei Cloud" },
	{ asn: 45102, name: "Alibaba Cloud" },
	{ asn: 132203, name: "Tencent Cloud" },
	{ asn: 45090, name: "Tencent Cloud" },
	{ asn: 24940, name: "Hetzner" },
	{ asn: 16276, name: "OVH" },
	{ asn: 14061, name: "DigitalOcean" },
	{ asn: 20473, name: "Vultr" },
	{ asn: 63949, name: "Linode" },
	{ asn: 12876, name: "Scaleway" },
];

const HOSTING_CATEGORY = "hosting";

const asnUrl = (asn: number) =>
	`https://raw.githubusercontent.com/ipverse/asn-ip/master/as/${asn}/aggregated.json`;

interface RangeIndex {
	v4ByOctet: Map<number, ParsedCidr[]>;
	v4Wide: ParsedCidr[];
	v6: ParsedCidr[];
}

const V4_OCTET_SHIFT = 2n ** 24n;

const STALE_MS = 6 * 60 * 60 * 1000;

const FETCH_TIMEOUT_MS = 20000;

const MEMO_LIMIT = 4096;

let index: RangeIndex = emptyIndex();

let loadedCidrs = 0;

let lastLoadedAt = 0;

let inFlight: Promise<void> | null = null;

const memo = new Map<string, boolean>();

function emptyIndex(): RangeIndex {
	return { v4ByOctet: new Map(), v4Wide: [], v6: [] };
}

function addToIndex(target: RangeIndex, cidr: ParsedCidr): void {
	if (cidr.version === 6) {
		target.v6.push(cidr);
		return;
	}
	if (cidr.bits < 8) {
		target.v4Wide.push(cidr);
		return;
	}
	const octet = Number(cidr.base / V4_OCTET_SHIFT);
	const bucket = target.v4ByOctet.get(octet);
	if (bucket) {
		bucket.push(cidr);
	} else {
		target.v4ByOctet.set(octet, [cidr]);
	}
}

async function fetchJson(url: string): Promise<unknown> {
	const res = await httpFetch(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		throw new Error(`${url} -> HTTP ${res.status}`);
	}
	return res.json();
}

async function fetchAsnPrefixes(asn: number, name: string): Promise<string[]> {
	const json = (await fetchJson(asnUrl(asn))) as {
		metadata?: {
			category?: string;
			description?: string;
		};
		prefixes?: {
			ipv4?: string[];
			ipv6?: string[];
		};
	};
	const category = json.metadata?.category;
	if (category !== HOSTING_CATEGORY) {
		console.warn(
			`[datacenter-ranges] skipping AS${asn} (${name}): categorised "${category ?? "unknown"}", not "${HOSTING_CATEGORY}"`,
		);
		return [];
	}
	return [...(json.prefixes?.ipv4 ?? []), ...(json.prefixes?.ipv6 ?? [])];
}

export async function refreshDatacenterRanges(): Promise<{
	sources: number;
	cidrs: number;
}> {
	const next = emptyIndex();
	let sources = 0;
	let cidrs = 0;
	const results = await Promise.allSettled([
		...CLOUD_FEEDS.map(async (feed) => ({
			label: feed.name,
			prefixes: feed.extract(await fetchJson(feed.url)),
		})),
		...HOSTING_ASNS.map(async ({ asn, name }) => ({
			label: `AS${asn} (${name})`,
			prefixes: await fetchAsnPrefixes(asn, name),
		})),
	]);
	for (const result of results) {
		if (result.status === "rejected") {
			console.warn(
				`[datacenter-ranges] source failed: ${(result.reason as Error).message}`,
			);
			continue;
		}
		const { prefixes } = result.value;
		if (prefixes.length === 0) {
			continue;
		}
		sources += 1;
		for (const raw of prefixes) {
			const parsed = parseCidr(raw);
			if (parsed) {
				addToIndex(next, parsed);
				cidrs += 1;
			}
		}
	}
	if (cidrs === 0) {
		console.warn(
			"[datacenter-ranges] every source failed; keeping the previous index",
		);
		return { sources: 0, cidrs: loadedCidrs };
	}
	index = next;
	loadedCidrs = cidrs;
	lastLoadedAt = Date.now();
	memo.clear();
	return { sources, cidrs };
}

export function warmDatacenterRangesInBackground(): void {
	if (inFlight) {
		return;
	}
	if (loadedCidrs > 0 && Date.now() - lastLoadedAt < STALE_MS) {
		return;
	}
	inFlight = refreshDatacenterRanges()
		.then(() => undefined)
		.catch((err) => {
			console.warn(
				`[datacenter-ranges] background warm failed: ${(err as Error).message}`,
			);
		})
		.finally(() => {
			inFlight = null;
		});
}

export function hasLoadedDatacenterRanges(): boolean {
	return loadedCidrs > 0;
}

export function isDatacenterIp(ip: string | undefined): boolean {
	if (!ip || loadedCidrs === 0) {
		return false;
	}
	const cached = memo.get(ip);
	if (cached !== undefined) {
		return cached;
	}
	const parsed = ipToBigInt(ip);
	let hit = false;
	if (parsed) {
		const candidates =
			parsed.version === 6
				? index.v6
				: [
						...(index.v4ByOctet.get(Number(parsed.value / V4_OCTET_SHIFT)) ??
							[]),
						...index.v4Wide,
					];
		hit = candidates.some((cidr) => parsedIpInCidr(parsed, cidr));
	}
	if (memo.size >= MEMO_LIMIT) {
		memo.clear();
	}
	memo.set(ip, hit);
	return hit;
}

export function __setDatacenterRangesForTest(cidrs: readonly string[]): void {
	const next = emptyIndex();
	let count = 0;
	for (const raw of cidrs) {
		const parsed = parseCidr(raw);
		if (parsed) {
			addToIndex(next, parsed);
			count += 1;
		}
	}
	index = next;
	loadedCidrs = count;
	lastLoadedAt = Date.now();
	memo.clear();
}

export function __clearDatacenterRangesForTest(): void {
	index = emptyIndex();
	loadedCidrs = 0;
	lastLoadedAt = 0;
	memo.clear();
}
