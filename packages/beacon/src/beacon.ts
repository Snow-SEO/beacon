import {
	type AnalyticsConfig,
	BeaconAnalytics,
	type WaitUntilContext,
} from "./analytics.js";
import { createDirResolver } from "./dir-resolver.js";

const TRAILING_SLASHES = /\/+$/;

import {
	injectAlternateLink,
	markdownResponse,
	notAcceptableResponse,
} from "./headers.js";
import { type LlmsTxtOptions, renderLlmsTxt } from "./llms-txt.js";
import { negotiateFormat } from "./negotiate.js";
import { fromMarkdownPath, isMarkdownPath, toMarkdownPath } from "./paths.js";
import {
	buildMdSitemap,
	robotsSitemapDirective,
	type SitemapEntry,
} from "./sitemap.js";

export interface ResolvedMarkdown {
	markdown: string;
	canonicalUrl?: string;
	originalTokens?: number;
	cacheControl?: string;
}

export type MarkdownResolver = (
	path: string,
	request: Request,
) =>
	| Promise<ResolvedMarkdown | string | null>
	| ResolvedMarkdown
	| string
	| null;

export interface BeaconConfig {
	siteUrl: string;
	dir?: string;
	resolve?: MarkdownResolver;
	analytics?: Omit<AnalyticsConfig, "host"> & {
		host?: string;
	};
	strictNegotiation?: boolean;
}

export interface HandleContext extends WaitUntilContext {
	statusCode?: number;
}

export class Beacon {
	readonly siteUrl: string;
	private readonly config: BeaconConfig;
	private readonly resolve: MarkdownResolver;
	private readonly analytics: BeaconAnalytics | null;
	constructor(config: BeaconConfig) {
		this.config = config;
		this.siteUrl = config.siteUrl.replace(TRAILING_SLASHES, "");
		warnOnLoopbackSiteUrl(this.siteUrl);
		if (config.resolve) {
			this.resolve = config.resolve;
		} else if (config.dir) {
			this.resolve = createDirResolver(config.dir);
		} else {
			throw new Error(
				"[beacon] createBeacon needs either `dir` (a directory of twins from `beacon build`) or `resolve`.",
			);
		}
		this.analytics = config.analytics
			? new BeaconAnalytics({
					...config.analytics,
					host: config.analytics.host ?? new URL(this.siteUrl).hostname,
				})
			: null;
	}
	async handle(
		request: Request,
		ctx?: HandleContext,
	): Promise<Response | null> {
		const url = new URL(request.url);
		const accept = request.headers.get("accept");
		const wantsMarkdownUrl = isMarkdownPath(url.pathname);
		const format = negotiateFormat(accept);
		if (!wantsMarkdownUrl && format !== "markdown") {
			if (format === null && this.config.strictNegotiation !== false) {
				return notAcceptableResponse();
			}
			return null;
		}
		const htmlPath = wantsMarkdownUrl
			? fromMarkdownPath(url.pathname)
			: url.pathname;
		const resolved = await this.resolveMarkdown(htmlPath, request);
		if (!resolved) {
			return null;
		}
		this.track(request, {
			...ctx,
			format: "markdown",
			statusCode: 200,
			path: htmlPath,
			askedForMarkdown: true,
		});
		return markdownResponse(resolved.markdown, {
			canonicalUrl: wantsMarkdownUrl
				? (resolved.canonicalUrl ?? `${this.siteUrl}${htmlPath}`)
				: undefined,
			originalTokens: resolved.originalTokens,
			cacheControl: resolved.cacheControl,
		});
	}
	private async resolveMarkdown(
		path: string,
		request: Request,
	): Promise<ResolvedMarkdown | null> {
		const result = await this.resolve(path, request);
		if (!result) {
			return null;
		}
		const normalized =
			typeof result === "string" ? { markdown: result } : result;
		return normalized.markdown.trim() ? normalized : null;
	}
	advertise(
		request: Request,
		response: Response,
		ctx?: HandleContext,
	): Response {
		const url = new URL(request.url);
		this.track(request, { ...ctx, format: "html", path: url.pathname });
		return injectAlternateLink(response, toMarkdownPath(url.pathname));
	}
	async advertiseIfPresent(
		request: Request,
		response: Response,
		ctx?: HandleContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (!(await this.resolveMarkdown(url.pathname, request))) {
			this.track(request, { ...ctx, format: "html", path: url.pathname });
			return response;
		}
		return this.advertise(request, response, ctx);
	}
	async hasTwin(path: string, request: Request): Promise<boolean> {
		return (await this.resolveMarkdown(path, request)) !== null;
	}
	track(
		request: Request,
		ctx?: HandleContext & {
			format?: "markdown" | "html";
			path?: string;
			askedForMarkdown?: boolean;
		},
	): void {
		if (!this.analytics) {
			return;
		}
		const url = new URL(request.url);
		const signature = request.headers.get("signature") ?? undefined;
		const signatureInput = request.headers.get("signature-input") ?? undefined;
		const signed = Boolean(signature && signatureInput);
		this.analytics.record(
			{
				path: ctx?.path ?? url.pathname,
				userAgent: request.headers.get("user-agent") ?? "",
				format: ctx?.format,
				statusCode: ctx?.statusCode,
				referrer: request.headers.get("referer") ?? undefined,
				ip: clientIp(request),
				method: request.method,
				signature,
				signatureInput,
				signatureAgent: request.headers.get("signature-agent") ?? undefined,
				rawPath: signed ? `${url.pathname}${url.search}` : undefined,
				askedForMarkdown: ctx?.askedForMarkdown ?? wantsMarkdown(request, url),
				fromBrowser: isFromBrowser(request),
			},
			ctx,
		);
	}
	flush(ctx?: WaitUntilContext): void {
		this.analytics?.flush(ctx);
	}
	markdownUrlFor(path: string): string {
		return `${this.siteUrl}${toMarkdownPath(path)}`;
	}
	llmsTxt(options: LlmsTxtOptions): Response {
		return new Response(renderLlmsTxt(options), {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
				"X-Robots-Tag": "index, follow",
			},
		});
	}
	sitemap(entries: readonly (string | SitemapEntry)[]): Response {
		const absolute = entries.map((entry) => {
			const value = typeof entry === "string" ? { url: entry } : { ...entry };
			value.url = value.url.startsWith("http")
				? value.url
				: `${this.siteUrl}${toMarkdownPath(value.url)}`;
			return value;
		});
		return new Response(buildMdSitemap(absolute), {
			headers: {
				"Content-Type": "application/xml; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
			},
		});
	}
	robotsDirective(sitemapPath = "/sitemap-md.xml"): string {
		return robotsSitemapDirective(`${this.siteUrl}${sitemapPath}`);
	}
}

function wantsMarkdown(request: Request, url: URL): boolean {
	return (
		isMarkdownPath(url.pathname) ||
		negotiateFormat(request.headers.get("accept")) === "markdown"
	);
}

function isFromBrowser(request: Request): boolean {
	return request.headers.has("sec-fetch-mode");
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function warnOnLoopbackSiteUrl(siteUrl: string): void {
	if (
		typeof process === "undefined" ||
		process.env?.NODE_ENV !== "production"
	) {
		return;
	}
	let hostname: string;
	try {
		hostname = new URL(siteUrl).hostname;
	} catch {
		return;
	}
	if (!(LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".local"))) {
		return;
	}
	console.warn(
		`[beacon] siteUrl is "${siteUrl}" in a production build. Markdown twins will ` +
			"declare a loopback rel=canonical, sitemap-md.xml will list unreachable URLs, " +
			"and crawler hits will be attributed to that host. Set siteUrl to your public origin.",
	);
}

const IP_HEADERS = [
	"cf-connecting-ip",
	"x-real-ip",
	"true-client-ip",
	"x-vercel-forwarded-for",
	"x-forwarded-for",
];

function clientIp(request: Request): string | undefined {
	for (const header of IP_HEADERS) {
		const value = request.headers.get(header);
		if (value) {
			return value.split(",")[0]?.trim();
		}
	}
	return undefined;
}

export function createBeacon(config: BeaconConfig): Beacon {
	return new Beacon(config);
}
