import { estimateTokens } from "./tokens.js";

export const BEACON_SPEC_VERSION = "1.0";

export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export const DEFAULT_CONTENT_SIGNAL = "ai-train=yes, search=yes, ai-input=yes";

const DEFAULT_CACHE_CONTROL = "public, max-age=3600";

export interface MarkdownResponseOptions {
	htmlUrl?: string;
	originalTokens?: number;
	cacheControl?: string;
	contentSignal?: string;
	status?: number;
	headers?: HeadersInit;
}

export function buildMarkdownHeaders(
	body: string,
	options: MarkdownResponseOptions = {},
): Headers {
	const headers = new Headers(options.headers);
	headers.set("Content-Type", MARKDOWN_CONTENT_TYPE);
	headers.set("X-Content-Type-Options", "nosniff");
	headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
	headers.set("X-Beacon-Version", BEACON_SPEC_VERSION);
	headers.set("X-Markdown-Tokens", String(estimateTokens(body)));
	if (options.originalTokens && options.originalTokens > 0) {
		headers.set("X-Original-Tokens", String(options.originalTokens));
	}
	if (!headers.has("X-Robots-Tag")) {
		headers.set("X-Robots-Tag", "noindex, follow");
	}
	if (!headers.has("Cache-Control")) {
		headers.set("Cache-Control", options.cacheControl ?? DEFAULT_CACHE_CONTROL);
	}
	if (!headers.has("Content-Signal")) {
		headers.set(
			"Content-Signal",
			options.contentSignal ?? DEFAULT_CONTENT_SIGNAL,
		);
	}
	if (options.htmlUrl) {
		headers.set(
			"Link",
			appendLink(
				headers.get("Link"),
				`<${options.htmlUrl}>; rel="alternate"; type="text/html"`,
			),
		);
	}
	return headers;
}

export function markdownResponse(
	body: string,
	options: MarkdownResponseOptions = {},
): Response {
	return new Response(body, {
		status: options.status ?? 200,
		headers: buildMarkdownHeaders(body, options),
	});
}

export function injectAlternateLink(
	response: Response,
	markdownUrl: string,
): Response {
	const link = `<${markdownUrl}>; rel="alternate"; type="text/markdown"`;
	try {
		response.headers.set(
			"Link",
			appendLink(response.headers.get("Link"), link),
		);
		response.headers.set(
			"Vary",
			mergeVary(response.headers.get("Vary"), "Accept"),
		);
		return response;
	} catch {
		const headers = new Headers(response.headers);
		headers.set("Link", appendLink(headers.get("Link"), link));
		headers.set("Vary", mergeVary(headers.get("Vary"), "Accept"));
		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}
}

export function mergeVary(existing: string | null, token: string): string {
	if (!existing) {
		return token;
	}
	const present = existing
		.split(",")
		.map((part) => part.trim().toLowerCase())
		.filter(Boolean);
	if (present.includes("*") || present.includes(token.toLowerCase())) {
		return existing;
	}
	return `${existing}, ${token}`;
}

export function appendLink(existing: string | null, link: string): string {
	if (!existing) {
		return link;
	}
	return existing.includes(link) ? existing : `${existing}, ${link}`;
}

export function notAcceptableResponse(): Response {
	return new Response("Not Acceptable", {
		status: 406,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			Vary: "Accept",
		},
	});
}
