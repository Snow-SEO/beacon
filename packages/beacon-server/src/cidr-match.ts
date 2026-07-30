import { isIP } from "node:net";

export interface ParsedCidr {
	version: 4 | 6;
	base: bigint;
	bits: number;
}

const V4_MAX_BITS = 32;

const V6_MAX_BITS = 128;

const V4_OCTET = 256n;

const V6_GROUP = 65536n;

const DECIMAL_1_3_RE = /^\d{1,3}$/;

const HEX_GROUP_RE = /^[0-9a-fA-F]{1,4}$/;

function ipv4ToBigInt(ip: string): bigint | null {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return null;
	}
	let acc = 0n;
	for (const part of parts) {
		if (!DECIMAL_1_3_RE.test(part)) {
			return null;
		}
		const n = Number(part);
		if (n > 255) {
			return null;
		}
		acc = acc * V4_OCTET + BigInt(n);
	}
	return acc;
}

function ipv6ToBigInt(ip: string): bigint | null {
	let text = ip.trim();
	if (text.startsWith("[") && text.endsWith("]")) {
		text = text.slice(1, -1);
	}
	const zone = text.indexOf("%");
	if (zone !== -1) {
		text = text.slice(0, zone);
	}
	const halves = text.split("::");
	if (halves.length > 2) {
		return null;
	}
	const toGroups = (segment: string): string[] | null => {
		if (segment === "") {
			return [];
		}
		const groups: string[] = [];
		for (const raw of segment.split(":")) {
			if (raw.includes(".")) {
				const v4 = ipv4ToBigInt(raw);
				if (v4 === null) {
					return null;
				}
				groups.push((v4 / V6_GROUP).toString(16), (v4 % V6_GROUP).toString(16));
				continue;
			}
			if (!HEX_GROUP_RE.test(raw)) {
				return null;
			}
			groups.push(raw);
		}
		return groups;
	};
	const head = toGroups(halves[0]);
	const tail = halves.length === 2 ? toGroups(halves[1]) : [];
	if (head === null || tail === null) {
		return null;
	}
	let full: string[];
	if (halves.length === 2) {
		const fill = 8 - head.length - tail.length;
		if (fill < 0) {
			return null;
		}
		full = [...head, ...new Array(fill).fill("0"), ...tail];
	} else {
		full = head;
	}
	if (full.length !== 8) {
		return null;
	}
	let acc = 0n;
	for (const group of full) {
		acc = acc * V6_GROUP + BigInt(Number.parseInt(group, 16));
	}
	return acc;
}

export function ipToBigInt(ip: string): {
	version: 4 | 6;
	value: bigint;
} | null {
	const family = isIP(ip);
	if (family === 4) {
		const value = ipv4ToBigInt(ip);
		return value === null ? null : { version: 4, value };
	}
	if (family === 6) {
		const value = ipv6ToBigInt(ip);
		return value === null ? null : { version: 6, value };
	}
	return null;
}

export function parseCidr(cidr: string): ParsedCidr | null {
	const slash = cidr.lastIndexOf("/");
	if (slash === -1) {
		return null;
	}
	const addr = cidr.slice(0, slash);
	const bitsRaw = cidr.slice(slash + 1);
	if (!DECIMAL_1_3_RE.test(bitsRaw)) {
		return null;
	}
	const bits = Number(bitsRaw);
	const parsed = ipToBigInt(addr);
	if (!parsed) {
		return null;
	}
	const maxBits = parsed.version === 4 ? V4_MAX_BITS : V6_MAX_BITS;
	if (bits > maxBits) {
		return null;
	}
	return {
		version: parsed.version,
		base: clearHostBits(parsed.value, bits, maxBits),
		bits,
	};
}

function clearHostBits(value: bigint, bits: number, maxBits: number): bigint {
	if (bits >= maxBits) {
		return value;
	}
	const divisor = 2n ** BigInt(maxBits - bits);
	return (value / divisor) * divisor;
}

export function parsedIpInCidr(
	parsed: {
		version: 4 | 6;
		value: bigint;
	},
	cidr: ParsedCidr,
): boolean {
	if (parsed.version !== cidr.version) {
		return false;
	}
	const maxBits = cidr.version === 4 ? V4_MAX_BITS : V6_MAX_BITS;
	return clearHostBits(parsed.value, cidr.bits, maxBits) === cidr.base;
}

export function ipInCidr(ip: string, cidr: ParsedCidr): boolean {
	const parsed = ipToBigInt(ip);
	return parsed ? parsedIpInCidr(parsed, cidr) : false;
}

export function ipInAnyCidr(ip: string, cidrs: readonly ParsedCidr[]): boolean {
	for (const cidr of cidrs) {
		if (ipInCidr(ip, cidr)) {
			return true;
		}
	}
	return false;
}
