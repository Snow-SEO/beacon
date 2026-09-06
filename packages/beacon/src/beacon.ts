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
	htmlUrl?: string;
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
	/**
	 * Your public origin, e.g. `https://example.com`.
	 *
	 * Required for anything that mints a URL — Markdown twins, `llmsTxt`,
	 * `sitemap`, `markdownUrlFor`. A **reporting-only** beacon (see
	 * {@link createBeacon}) mints no URLs, so it may be omitted there; the
	 * collector resolves the site from the API key instead.
	 */
	siteUrl?: string;
	dir?: string;
	resolve?: MarkdownResolver;
	analytics?: AnalyticsConfig;
	/**
	 * Answer `406` when a request accepts neither HTML nor Markdown. Defaults to
	 * `true` when this beacon serves twins and `false` when it is
	 * reporting-only, where refusing a request it will never answer would only
	 * break the site's own JSON endpoints.
	 */
	strictNegotiation?: boolean;
	getIp?: (request: Request) => string | null | undefined;
	exists?: (path: string, request: Request) => Promise<boolean> | boolean;
}

export interface HandleContext extends WaitUntilContext {
	statusCode?: number;
}

export class Beacon {
	/** Empty on a reporting-only beacon; use {@link requireSiteUrl} internally. */
	readonly siteUrl: string;
	/** True when this beacon only reports crawler hits and serves no twins. */
	readonly reportingOnly: boolean;
	private readonly config: BeaconConfig;
	private readonly resolve: MarkdownResolver;
	private readonly analytics: BeaconAnalytics | null;
	constructor(config: BeaconConfig) {
		this.config = config;
		this.siteUrl = (config.siteUrl ?? "").replace(TRAILING_SLASHES, "");
		if (this.siteUrl) {
			warnOnLoopbackSiteUrl(this.siteUrl);
		}
		this.reportingOnly = !(config.resolve || config.dir);
		if (config.resolve) {
			this.resolve = config.resolve;
		} else if (config.dir) {
			this.resolve = createDirResolver(config.dir);
		} else if (config.analytics) {
			// Reporting-only. Measuring crawlers and serving them Markdown are
			// separate jobs, and the config for "just measure" used to be a
			// `resolve: () => null` whose only purpose was to satisfy this check —
			// boilerplate that read like it did something.
			this.resolve = () => null;
		} else {
			throw new Error(
				"[beacon] createBeacon needs `dir` (a directory of twins from `beacon build`), `resolve`, or `analytics` for a reporting-only install.",
			);
		}
		this.analytics = config.analytics
			? new BeaconAnalytics({
					...config.analytics,
					host: config.analytics.host ?? hostOf(this.siteUrl),
				})
			: null;
	}
	/**
	 * The origin, or a message naming the option that is missing. Only the
	 * URL-minting methods need it, so a reporting-only beacon never reaches this.
	 */
	private requireSiteUrl(feature: string): string {
		if (!this.siteUrl) {
			throw new Error(
				`[beacon] ${feature} needs \`siteUrl\` — it mints absolute URLs. Pass siteUrl to createBeacon.`,
			);
		}
		return this.siteUrl;
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
			const strict = this.config.strictNegotiation ?? !this.reportingOnly;
			if (format === null && strict) {
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
			htmlUrl: wantsMarkdownUrl
				? (resolved.htmlUrl ??
					`${this.requireSiteUrl("Markdown twins")}${htmlPath}`)
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
		if (!(await this.hasTwin(url.pathname, request))) {
			this.track(request, { ...ctx, format: "html", path: url.pathname });
			return response;
		}
		return this.advertise(request, response, ctx);
	}

	async hasTwin(path: string, request: Request): Promise<boolean> {
		const exists = this.config.exists;
		if (exists) {
			return (await exists(path, request)) === true;
		}
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
				ip: clientIp(request, this.config.getIp),
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
		return `${this.requireSiteUrl("markdownUrlFor")}${toMarkdownPath(path)}`;
	}
	llmsTxt(options: LlmsTxtOptions): Response {
		return new Response(renderLlmsTxt(options), {
			headers: {
				"Content-Type": "text/plain; charset=utf-8",
				"Cache-Control": "public, max-age=3600",
				// A manifest, not content. Agents fetch it directly at its
				// well-known path, so it never needs to be in a search index, and
				// a bare list of links has no business ranking on its own.
				"X-Robots-Tag": "noindex, follow",
			},
		});
	}
	sitemap(entries: readonly (string | SitemapEntry)[]): Response {
		const absolute = entries.map((entry) => {
			const value = typeof entry === "string" ? { url: entry } : { ...entry };
			value.url = value.url.startsWith("http")
				? value.url
				: `${this.requireSiteUrl("sitemap")}${toMarkdownPath(value.url)}`;
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
		return robotsSitemapDirective(
			`${this.requireSiteUrl("robotsDirective")}${sitemapPath}`,
		);
	}
	robotsLlmsDirective(llmsPath = "/llms.txt"): string {
		return `# Markdown index: ${this.requireSiteUrl("robotsLlmsDirective")}${llmsPath}`;
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

/** Hostname of an origin, or undefined when there is no origin to read. */
function hostOf(siteUrl: string): string | undefined {
	if (!siteUrl) {
		return undefined;
	}
	try {
		return new URL(siteUrl).hostname;
	} catch {
		return undefined;
	}
}

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
	"fastly-client-ip",
	"fly-client-ip",
	"x-vercel-forwarded-for",
	"x-forwarded-for",
];

const IPV4_MAPPED_IPV6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

function normalizeIp(value: string | null | undefined): string | undefined {
	const first = value?.split(",")[0]?.trim();
	if (!first) {
		return undefined;
	}
	return IPV4_MAPPED_IPV6.exec(first)?.[1] ?? first;
}

function clientIp(
	request: Request,
	getIp?: BeaconConfig["getIp"],
): string | undefined {
	const custom = normalizeIp(getIp?.(request));
	if (custom) {
		return custom;
	}
	for (const header of IP_HEADERS) {
		const value = normalizeIp(request.headers.get(header));
		if (value) {
			return value;
		}
	}
	return undefined;
}

export function createBeacon(config: BeaconConfig): Beacon {
	return new Beacon(config);
}
