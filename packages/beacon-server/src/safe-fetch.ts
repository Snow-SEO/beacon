import { promises as dns } from "node:dns";
import { validatePublicHttpUrl } from "./url-validation.js";

export class SsrfBlockedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SsrfBlockedError";
	}
}

const IPV4_LITERAL_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

const MULTICAST_RESERVED_IPV4_RE = /^(2(2[4-9]|3\d|4\d|5[0-5]))\./;

const IPV4_MAPPED_IPV6_RE = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

const NAT64_IPV6_RE = /^64:ff9b(:|$)/;

const LINK_LOCAL_IPV6_RE = /^fe[89a-f]/i;

function isPrivateClassB(ip: string): boolean {
	const parts = ip.split(".");
	if (parts.length !== 4) {
		return false;
	}
	const second = Number.parseInt(parts[1], 10);
	return second >= 16 && second <= 31;
}

function isForbiddenIPv4(ip: string): boolean {
	if (ip.startsWith("10.")) {
		return true;
	}
	if (ip.startsWith("192.168.")) {
		return true;
	}
	if (ip.startsWith("127.")) {
		return true;
	}
	if (ip.startsWith("172.") && isPrivateClassB(ip)) {
		return true;
	}
	if (ip.startsWith("169.254.")) {
		return true;
	}
	if (ip.startsWith("0.")) {
		return true;
	}
	if (ip.startsWith("255.")) {
		return true;
	}
	if (ip.startsWith("100.")) {
		const second = Number.parseInt(ip.split(".")[1] ?? "0", 10);
		if (second >= 64 && second <= 127) {
			return true;
		}
	}
	if (MULTICAST_RESERVED_IPV4_RE.test(ip)) {
		return true;
	}
	if (ip.startsWith("198.18.") || ip.startsWith("198.19.")) {
		return true;
	}
	return false;
}

function isForbiddenIPv6(ip: string): boolean {
	const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized.startsWith("::")) {
		return true;
	}
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
		return true;
	}
	if (LINK_LOCAL_IPV6_RE.test(normalized) || normalized.startsWith("ff")) {
		return true;
	}
	const mapped = normalized.match(IPV4_MAPPED_IPV6_RE);
	if (mapped) {
		return isForbiddenIPv4(mapped[1]);
	}
	if (NAT64_IPV6_RE.test(normalized)) {
		return true;
	}
	return false;
}

export async function assertResolvedHostIsPublic(
	hostname: string,
): Promise<void> {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (IPV4_LITERAL_RE.test(host)) {
		if (isForbiddenIPv4(host)) {
			throw new SsrfBlockedError(`Blocked private/reserved IPv4: ${host}`);
		}
		return;
	}
	if (host.includes(":")) {
		if (isForbiddenIPv6(host)) {
			throw new SsrfBlockedError(`Blocked private/reserved IPv6: ${host}`);
		}
		return;
	}
	let addrs: {
		address: string;
		family: number;
	}[];
	try {
		addrs = await dns.lookup(host, { all: true, verbatim: true });
	} catch {
		throw new SsrfBlockedError(`DNS resolution failed for ${host}`);
	}
	if (addrs.length === 0) {
		throw new SsrfBlockedError(`No DNS records for ${host}`);
	}
	for (const { address, family } of addrs) {
		if (family === 4 && isForbiddenIPv4(address)) {
			throw new SsrfBlockedError(`${host} resolves to private IPv4 ${address}`);
		}
		if (family === 6 && isForbiddenIPv6(address)) {
			throw new SsrfBlockedError(`${host} resolves to private IPv6 ${address}`);
		}
	}
}

export async function assertUrlPublic(rawUrl: string): Promise<string> {
	const normalized = validatePublicHttpUrl(rawUrl);
	if (!normalized) {
		throw new SsrfBlockedError(`Rejected URL: ${rawUrl}`);
	}
	await assertResolvedHostIsPublic(new URL(normalized).hostname);
	return normalized;
}

export interface SafeFetchInit extends RequestInit {
	maxRedirects?: number;
}

export async function safeFetch(
	url: string | URL,
	init: SafeFetchInit = {},
): Promise<Response> {
	const { maxRedirects = 5, headers, method, body, ...rest } = init;
	let currentUrl = await assertUrlPublic(
		typeof url === "string" ? url : url.toString(),
	);
	let currentMethod = method ?? "GET";
	let currentBody = body;
	const currentHeaders = new Headers(headers);
	for (let hop = 0; hop <= maxRedirects; hop++) {
		const response = await fetch(currentUrl, {
			...rest,
			method: currentMethod,
			body: currentBody,
			headers: currentHeaders,
			redirect: "manual",
		});
		const location = response.headers.get("location");
		if (response.status >= 300 && response.status < 400 && location) {
			if (hop === maxRedirects) {
				throw new SsrfBlockedError("Too many redirects");
			}
			const previousOrigin = new URL(currentUrl).origin;
			const nextUrl = await assertUrlPublic(
				new URL(location, currentUrl).toString(),
			);
			if (new URL(nextUrl).origin !== previousOrigin) {
				currentHeaders.delete("authorization");
				currentHeaders.delete("cookie");
				currentHeaders.delete("x-plugin-key");
				currentHeaders.delete("x-api-key");
			}
			if (
				response.status !== 307 &&
				response.status !== 308 &&
				currentMethod !== "GET" &&
				currentMethod !== "HEAD"
			) {
				currentMethod = "GET";
				currentBody = undefined;
			}
			currentUrl = nextUrl;
			continue;
		}
		return response;
	}
	throw new SsrfBlockedError("Too many redirects");
}
