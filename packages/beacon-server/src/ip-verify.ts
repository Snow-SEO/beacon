import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import {
	findProviderOwningIp,
	hasLoadedRanges,
	hasReliableRanges,
	isIpInProviderRanges,
} from "./crawler-ranges.js";

export type VerifyState =
	| "signed"
	| "verified"
	| "unverified"
	| "spoofed_suspected";

export type VerifyMethod = "cidr" | "reverse_dns" | "web_bot_auth";

export interface VerifyVerdict {
	verified: boolean;
	state: VerifyState;
	method: VerifyMethod | null;
}

const UNVERIFIED: VerifyVerdict = {
	verified: false,
	state: "unverified",
	method: null,
};

const RDNS_NO_PTR: VerifyVerdict = {
	verified: false,
	state: "unverified",
	method: "reverse_dns",
};

const RDNS_FOREIGN: VerifyVerdict = {
	verified: false,
	state: "spoofed_suspected",
	method: "reverse_dns",
};

const PROVIDER_RDNS_SUFFIXES: Record<string, readonly string[]> = {
	Apple: [".applebot.apple.com"],
	Amazon: [".crawl.amazonbot.amazon"],
	Microsoft: [".search.msn.com"],
	Google: [".googlebot.com", ".google.com"],
	"Common Crawl": [".crawl.commoncrawl.org"],
	"You.com": [".search.you.com"],
	Perplexity: [".perplexity.ai"],
};

export function verifyCrawlerIpSync(
	ip: string | undefined,
	provider: string,
): VerifyVerdict {
	if (!ip || isIP(ip) === 0) {
		return UNVERIFIED;
	}
	if (isIpInProviderRanges(ip, provider)) {
		return { verified: true, state: "verified", method: "cidr" };
	}
	const owner = findProviderOwningIp(ip);
	if (owner && owner !== provider) {
		return { verified: false, state: "spoofed_suspected", method: "cidr" };
	}
	if (hasLoadedRanges(provider) && hasReliableRanges(provider)) {
		return { verified: false, state: "spoofed_suspected", method: "cidr" };
	}
	return UNVERIFIED;
}

export function shouldDeferReverseDns(
	provider: string,
	state: VerifyState,
): boolean {
	return state === "unverified" && provider in PROVIDER_RDNS_SUFFIXES;
}

export async function verifyByReverseDns(
	ip: string,
	provider: string,
): Promise<VerifyVerdict> {
	const suffixes = PROVIDER_RDNS_SUFFIXES[provider];
	if (!suffixes || isIP(ip) === 0) {
		return UNVERIFIED;
	}
	let hostnames: string[];
	try {
		hostnames = await dns.reverse(ip);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "ENOTFOUND" || code === "ENODATA"
			? RDNS_NO_PTR
			: UNVERIFIED;
	}
	const host = hostnames.find((h) => {
		const lower = h.toLowerCase();
		return suffixes.some((s) => lower.endsWith(s));
	});
	if (!host) {
		return hasReliableRanges(provider) ? RDNS_FOREIGN : RDNS_NO_PTR;
	}
	try {
		const addrs =
			isIP(ip) === 6 ? await dns.resolve6(host) : await dns.resolve4(host);
		if (addrs.includes(ip)) {
			return { verified: true, state: "verified", method: "reverse_dns" };
		}
	} catch {
		return UNVERIFIED;
	}
	return RDNS_FOREIGN;
}
