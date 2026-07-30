function isPrivateOrLoopbackIPv4(parts: string[]): boolean {
	if (parts.length !== 4) return false;
	const a = Number.parseInt(parts[0], 10);
	const b = Number.parseInt(parts[1], 10);
	const c = Number.parseInt(parts[2], 10);
	const d = Number.parseInt(parts[3], 10);
	if (
		Number.isNaN(a) ||
		Number.isNaN(b) ||
		Number.isNaN(c) ||
		Number.isNaN(d)
	) {
		return false;
	}
	if (
		a < 0 ||
		a > 255 ||
		b < 0 ||
		b > 255 ||
		c < 0 ||
		c > 255 ||
		d < 0 ||
		d > 255
	) {
		return false;
	}
	if (a === 127) return true;
	if (a === 10) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 169 && b === 254) return true;
	if (a === 0) return true;
	return false;
}

const LINK_LOCAL_IPV6_PREFIX_RE = /^fe[89a-f]/i;

const NAT64_IPV6_PREFIX_RE = /^64:ff9b(:|$)/;

function isPrivateOrLoopbackIPv6(hostname: string): boolean {
	const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (normalized.startsWith("::")) return true;
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
	if (LINK_LOCAL_IPV6_PREFIX_RE.test(normalized)) return true;
	if (normalized.startsWith("ff")) return true;
	if (NAT64_IPV6_PREFIX_RE.test(normalized)) return true;
	return false;
}

export function validatePublicHttpUrl(
	input: string | null | undefined,
): string | null {
	if (input == null || typeof input !== "string") return null;
	const trimmed = input.trim();
	if (trimmed.length === 0) return null;
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}
	const protocol = url.protocol.toLowerCase();
	if (protocol !== "http:" && protocol !== "https:") {
		return null;
	}
	const hostname = url.hostname.toLowerCase();
	if (!hostname) return null;
	if (hostname === "localhost" || hostname.endsWith(".localhost")) {
		return null;
	}
	const isIPv6Literal = hostname.includes(":");
	if (!isIPv6Literal) {
		const hostLabels = hostname.split(".");
		if (
			hostLabels.length < 2 ||
			hostLabels.some((label) => label.length === 0)
		) {
			return null;
		}
	}
	const ipv4Match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
	if (ipv4Match.test(hostname)) {
		const octets = hostname.split(".");
		if (isPrivateOrLoopbackIPv4(octets)) return null;
	}
	if (isIPv6Literal && isPrivateOrLoopbackIPv6(hostname)) return null;
	const normalized = `${url.origin}${url.pathname.replace(/\/+$/, "")}${url.search}`;
	return normalized;
}
