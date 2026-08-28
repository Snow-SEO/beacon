import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BeaconAnalytics } from "../src/analytics.js";
import { createBeacon } from "../src/beacon.js";
import { extractMetadata, htmlToMarkdown } from "../src/convert.js";
import {
	createFetchResolver,
	TWIN_FETCH_HEADER,
} from "../src/fetch-resolver.js";
import { appendLink, markdownResponse, mergeVary } from "../src/headers.js";
import { renderLlmsTxt } from "../src/llms-txt.js";
import { negotiateFormat, parseAcceptHeader } from "../src/negotiate.js";
import {
	fromMarkdownPath,
	isMarkdownPath,
	toMarkdownPath,
} from "../src/paths.js";
import {
	buildMdSitemap,
	buildSitemapIndex,
	chunkSitemapEntries,
	escapeXml,
	MAX_URLS_PER_SITEMAP,
} from "../src/sitemap.js";

describe("paths", () => {
	it("maps pages to twins and back", () => {
		assert.equal(toMarkdownPath("/pricing"), "/pricing.md");
		assert.equal(toMarkdownPath("/pricing/"), "/pricing.md");
		assert.equal(toMarkdownPath("/"), "/index.md");
		assert.equal(fromMarkdownPath("/pricing.md"), "/pricing");
		assert.equal(fromMarkdownPath("/index.md"), "/");
	});
	it("is idempotent", () => {
		assert.equal(toMarkdownPath("/a.md"), "/a.md");
		assert.equal(fromMarkdownPath("/a"), "/a");
	});
	it("detects twin paths", () => {
		assert.ok(isMarkdownPath("/a.md"));
		assert.ok(!isMarkdownPath("/a.markdown"));
	});
});
describe("negotiate", () => {
	it("orders by quality", () => {
		const parsed = parseAcceptHeader("text/html;q=0.8, text/markdown;q=0.9");
		assert.equal(parsed[0]?.subtype, "markdown");
	});
	it("serves markdown only when asked", () => {
		assert.equal(negotiateFormat("text/markdown"), "markdown");
		assert.equal(negotiateFormat("text/markdown, text/html;q=0.5"), "markdown");
		assert.equal(negotiateFormat("text/html"), "html");
	});
	it("treats */* as html, since that is what browsers send", () => {
		assert.equal(negotiateFormat("*/*"), "html");
		assert.equal(negotiateFormat(null), "html");
	});
	it("returns null when neither is acceptable", () => {
		assert.equal(negotiateFormat("application/pdf"), null);
	});
	it("honours q=0 as a refusal", () => {
		assert.equal(negotiateFormat("text/markdown;q=0, text/html"), "html");
	});
});
describe("headers", () => {
	it("holds the twin out of search by default", () => {
		const res = markdownResponse("# Hi");
		assert.equal(res.headers.get("x-robots-tag"), "noindex, follow");
	});
	it("sets the markdown content type, vary and token count", () => {
		const res = markdownResponse("# Hi there");
		assert.equal(
			res.headers.get("content-type"),
			"text/markdown; charset=utf-8",
		);
		assert.equal(res.headers.get("vary"), "Accept");
		assert.ok(Number(res.headers.get("x-markdown-tokens")) > 0);
		assert.equal(res.headers.get("x-content-type-options"), "nosniff");
	});
	it("emits the HTML back-link only when given one", () => {
		assert.equal(markdownResponse("x").headers.get("link"), null);
		const res = markdownResponse("x", {
			htmlUrl: "https://e.com/pricing",
		});
		assert.equal(
			res.headers.get("link"),
			'<https://e.com/pricing>; rel="alternate"; type="text/html"',
		);
	});
	it("lets an explicit override through", () => {
		const res = markdownResponse("x", {
			headers: { "X-Robots-Tag": "noindex" },
		});
		assert.equal(res.headers.get("x-robots-tag"), "noindex");
	});
	it("merges Vary without duplicating", () => {
		assert.equal(
			mergeVary("Accept-Encoding", "Accept"),
			"Accept-Encoding, Accept",
		);
		assert.equal(mergeVary("accept", "Accept"), "accept");
		assert.equal(mergeVary("*", "Accept"), "*");
		assert.equal(mergeVary(null, "Accept"), "Accept");
	});
	it("appends link values", () => {
		assert.equal(
			appendLink("<a>; rel=x", "<b>; rel=y"),
			"<a>; rel=x, <b>; rel=y",
		);
		assert.equal(appendLink("<a>; rel=x", "<a>; rel=x"), "<a>; rel=x");
	});
});
describe("Beacon.handle", () => {
	const beacon = createBeacon({
		siteUrl: "https://e.com",
		resolve: (path) => (path === "/pricing" ? "# Pricing" : null),
	});
	it("serves the twin at the .md URL with an HTML back-link", async () => {
		const res = await beacon.handle(new Request("https://e.com/pricing.md"));
		assert.ok(res);
		assert.equal(await res.text(), "# Pricing");
		assert.equal(
			res.headers.get("link"),
			'<https://e.com/pricing>; rel="alternate"; type="text/html"',
		);
		assert.equal(res.headers.get("x-robots-tag"), "noindex, follow");
	});
	it("serves markdown on the canonical URL without a back-link", async () => {
		const res = await beacon.handle(
			new Request("https://e.com/pricing", {
				headers: { accept: "text/markdown" },
			}),
		);
		assert.ok(res);
		assert.equal(res.headers.get("link"), null);
	});
	it("falls through to HTML for an unmapped path", async () => {
		assert.equal(
			await beacon.handle(
				new Request("https://e.com/about", {
					headers: { accept: "text/markdown" },
				}),
			),
			null,
		);
		assert.equal(
			await beacon.handle(new Request("https://e.com/about.md")),
			null,
		);
	});
	it("ignores ordinary browser requests", async () => {
		assert.equal(
			await beacon.handle(
				new Request("https://e.com/pricing", { headers: { accept: "*/*" } }),
			),
			null,
		);
	});
	it("answers 406 when neither representation is acceptable", async () => {
		const res = await beacon.handle(
			new Request("https://e.com/pricing", {
				headers: { accept: "application/pdf" },
			}),
		);
		assert.equal(res?.status, 406);
	});
	it("advertises the twin on an HTML response", () => {
		const res = beacon.advertise(
			new Request("https://e.com/pricing"),
			new Response("<html></html>"),
		);
		assert.equal(
			res.headers.get("link"),
			'</pricing.md>; rel="alternate"; type="text/markdown"',
		);
		assert.equal(res.headers.get("vary"), "Accept");
	});
	it("advertises a relative twin, never the bind address, behind a proxy", () => {
		const res = beacon.advertise(
			new Request("https://localhost:3811/blog/server-components", {
				headers: {
					host: "attacker.example",
					"x-forwarded-host": "public.example",
					"x-forwarded-proto": "https",
				},
			}),
			new Response("<html></html>"),
		);
		const link = res.headers.get("link") ?? "";
		assert.equal(
			link,
			'</blog/server-components.md>; rel="alternate"; type="text/markdown"',
		);
		assert.ok(!link.includes("localhost"));
		assert.ok(!link.includes("attacker.example"));
		assert.ok(!link.includes("public.example"));
	});
	it("does not fabricate a status for the HTML hit", () => {
		const hits: {
			statusCode?: number;
		}[] = [];
		const tracked = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => "# hi",
			analytics: {
				key: "sb_dev_t_1",
				onHit: (hit) => hits.push(hit),
				endpoint: "https://collector.invalid/hits",
			},
		});
		tracked.advertise(
			new Request("https://e.com/pricing", {
				headers: { "user-agent": "Mozilla/5.0 (compatible; GPTBot/1.2)" },
			}),
			new Response("<html></html>", { status: 200 }),
		);
		assert.equal(hits.length, 1);
		assert.equal(hits[0]?.statusCode, undefined);
	});
	it("records a markdown request for a page that has no twin", async () => {
		const sent: {
			path: string;
			askedForMarkdown?: boolean;
		}[] = [];
		const tracked = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => null,
			analytics: {
				key: "sb_dev_t_1",
				endpoint: "https://collector.invalid/hits",
				fetch: ((_url: string, init: RequestInit) => {
					sent.push(...JSON.parse(String(init.body)).hits);
					return Promise.resolve(new Response("", { status: 200 }));
				}) as unknown as typeof fetch,
				batchSize: 1,
			},
		});
		const request = new Request("https://e.com/pricing", {
			headers: { accept: "text/markdown", "user-agent": "axios/1.8.4" },
		});
		assert.equal(await tracked.handle(request), null);
		await tracked.advertiseIfPresent(request, new Response("<html></html>"));
		assert.equal(sent.length, 1);
		assert.equal(sent[0]?.path, "/pricing");
		assert.equal(sent[0]?.askedForMarkdown, true);
	});
	it("flags a browser hit to a .md URL, leaves an agent fetch unflagged", async () => {
		const sent: {
			path: string;
			fromBrowser?: boolean;
		}[] = [];
		const tracked = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => "# Pricing",
			analytics: {
				key: "sb_dev_t_1",
				endpoint: "https://collector.invalid/hits",
				fetch: ((_url: string, init: RequestInit) => {
					sent.push(...JSON.parse(String(init.body)).hits);
					return Promise.resolve(new Response("", { status: 200 }));
				}) as unknown as typeof fetch,
				batchSize: 1,
			},
		});
		await tracked.handle(
			new Request("https://e.com/pricing.md", {
				headers: {
					accept: "text/html,application/xhtml+xml",
					"user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120",
					"sec-fetch-mode": "navigate",
				},
			}),
		);
		await tracked.handle(
			new Request("https://e.com/pricing.md", {
				headers: {
					accept: "*/*",
					"user-agent": "Mozilla/5.0 (Macintosh) AppleWebKit Chrome/120",
					"sec-fetch-mode": "no-cors",
				},
			}),
		);
		await tracked.handle(
			new Request("https://e.com/pricing.md", {
				headers: { accept: "text/markdown", "user-agent": "axios/1.8.4" },
			}),
		);
		assert.equal(sent.length, 3);
		assert.equal(sent[0]?.fromBrowser, true);
		assert.equal(sent[1]?.fromBrowser, true);
		assert.equal(sent[2]?.fromBrowser, false);
	});
	it("treats whitespace-only markdown as absent", async () => {
		const empty = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => "   \n  ",
		});
		assert.equal(await empty.handle(new Request("https://e.com/x.md")), null);
	});
});
describe("robots.txt directives", () => {
	const beacon = createBeacon({
		siteUrl: "https://e.com",
		resolve: () => null,
	});
	it("builds the llms.txt hint as a comment, not a directive", () => {
		// A comment asks nothing of a search engine, which is the point: it puts
		// the index where an agent will find it without submitting anything.
		const line = beacon.robotsLlmsDirective();
		assert.equal(line, "# Markdown index: https://e.com/llms.txt");
		assert.ok(line.startsWith("#"));
	});
	it("still builds a Sitemap line for anyone who opts into indexable twins", () => {
		assert.equal(
			beacon.robotsDirective(),
			"Sitemap: https://e.com/sitemap-md.xml",
		);
	});
});
describe("sitemap", () => {
	it("escapes XML", () => {
		assert.equal(escapeXml(`a&b<c>"d'`), "a&amp;b&lt;c&gt;&quot;d&apos;");
		const xml = buildMdSitemap(["https://e.com/a.md?x=1&y=2"]);
		assert.ok(xml.includes("x=1&amp;y=2"));
		assert.ok(!xml.includes("x=1&y=2"));
	});
	it("renders optional fields", () => {
		const xml = buildMdSitemap([
			{ url: "https://e.com/a.md", lastmod: "2026-01-01", priority: 0.75 },
		]);
		assert.ok(xml.includes("<lastmod>2026-01-01</lastmod>"));
		assert.ok(xml.includes("<priority>0.8</priority>"));
	});
	it("refuses to exceed the 50,000 URL limit", () => {
		const many = Array.from(
			{ length: MAX_URLS_PER_SITEMAP + 1 },
			(_, i) => `https://e.com/${i}.md`,
		);
		assert.throws(() => buildMdSitemap(many), RangeError);
	});
	it("chunks and indexes", () => {
		const chunks = chunkSitemapEntries([1, 2, 3, 4, 5], 2);
		assert.deepEqual(chunks, [[1, 2], [3, 4], [5]]);
		const index = buildSitemapIndex(["https://e.com/sitemap-md-0.xml"]);
		assert.ok(index.includes("<sitemapindex"));
		assert.ok(index.includes("sitemap-md-0.xml"));
	});
	it("builds absolute twin URLs from paths", async () => {
		const beacon = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => null,
		});
		const xml = await beacon.sitemap(["/pricing", "/docs/intro"]).text();
		assert.ok(xml.includes("<loc>https://e.com/pricing.md</loc>"));
		assert.ok(xml.includes("<loc>https://e.com/docs/intro.md</loc>"));
	});
});
describe("llms.txt", () => {
	it("renders the llmstxt.org shape", () => {
		const out = renderLlmsTxt({
			name: "Example",
			summary: "One line.",
			sections: [
				{
					title: "Docs",
					links: [
						{
							title: "Intro",
							url: "https://e.com/a.md",
							description: "Start here",
						},
					],
				},
			],
		});
		assert.ok(out.startsWith("# Example\n"));
		assert.ok(out.includes("> One line."));
		assert.ok(out.includes("## Docs"));
		assert.ok(out.includes("- [Intro](https://e.com/a.md): Start here"));
	});
	it("skips empty sections", () => {
		const out = renderLlmsTxt({
			name: "E",
			sections: [{ title: "X", links: [] }],
		});
		assert.ok(!out.includes("## X"));
	});
});
describe("htmlToMarkdown", () => {
	it("converts headings, emphasis and links", () => {
		const md = htmlToMarkdown(
			"<main><h1>Title</h1><p>Some <strong>bold</strong> and <em>italic</em> text with a <a href='/x'>link</a>.</p></main>",
			{ baseUrl: "https://e.com" },
		);
		assert.ok(md.includes("# Title"));
		assert.ok(md.includes("**bold**"));
		assert.ok(md.includes("*italic*"));
		assert.ok(md.includes("[link](https://e.com/x)"));
	});
	it("drops scripts, styles and navigation chrome", () => {
		const md = htmlToMarkdown(
			"<body><nav>Home About</nav><script>var x=1;alert('no')</script><style>.a{color:red}</style><main><p>Real content</p></main></body>",
		);
		assert.ok(md.includes("Real content"));
		assert.ok(!md.includes("alert"));
		assert.ok(!md.includes("color:red"));
		assert.ok(!md.includes("Home About"));
	});
	it("converts lists", () => {
		const md = htmlToMarkdown("<main><ul><li>one</li><li>two</li></ul></main>");
		assert.ok(md.includes("- one"));
		assert.ok(md.includes("- two"));
	});
	it("numbers ordered lists", () => {
		const md = htmlToMarkdown("<main><ol><li>a</li><li>b</li></ol></main>");
		assert.ok(md.includes("1. a"));
		assert.ok(md.includes("2. b"));
	});
	it("converts tables with a header separator", () => {
		const md = htmlToMarkdown(
			"<main><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></main>",
		);
		assert.ok(md.includes("| A | B |"));
		assert.ok(md.includes("| --- | --- |"));
		assert.ok(md.includes("| 1 | 2 |"));
	});
	it("decodes entities", () => {
		const md = htmlToMarkdown(
			"<main><p>Tom &amp; Jerry &#39;s &nbsp;caf&#233;</p></main>",
		);
		assert.ok(md.includes("Tom & Jerry 's"));
		assert.ok(md.includes("café"));
	});
	it("preserves code blocks", () => {
		const md = htmlToMarkdown(
			"<main><pre><code>const a = 1;</code></pre></main>",
		);
		assert.ok(md.includes("```"));
		assert.ok(md.includes("const a = 1;"));
	});
	it("handles images with absolute urls", () => {
		const md = htmlToMarkdown(
			"<main><p><img src='/a.png' alt='Alt'></p></main>",
			{
				baseUrl: "https://e.com",
			},
		);
		assert.ok(md.includes("![Alt](https://e.com/a.png)"));
	});
	it("lets unknown wrappers fall through without eating content", () => {
		const md = htmlToMarkdown(
			"<main><custom-block><p>Inside</p></custom-block></main>",
		);
		assert.ok(md.includes("Inside"));
	});
	it("extracts metadata", () => {
		const meta = extractMetadata(
			"<html><head><title>T &amp; Co</title><meta name='description' content='D'></head></html>",
		);
		assert.equal(meta.title, "T & Co");
		assert.equal(meta.description, "D");
	});
});
describe("negotiate regressions", () => {
	it("never serves markdown for a wildcard alone", () => {
		assert.equal(negotiateFormat("*/*"), "html");
		assert.equal(negotiateFormat("text/*"), "html");
	});
	it("respects a refusal that sorts after a wildcard", () => {
		assert.equal(negotiateFormat("text/html;q=0, */*"), "markdown");
		assert.equal(negotiateFormat("*/*;q=0, text/markdown"), "markdown");
	});
	it("handles a real browser Accept header", () => {
		assert.equal(
			negotiateFormat(
				"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
			),
			"html",
		);
	});
	it("honours available-set restrictions", () => {
		assert.equal(negotiateFormat("*/*", ["markdown"]), "markdown");
		assert.equal(negotiateFormat("text/html", ["markdown"]), null);
	});
});
describe("convert regressions", () => {
	it("strips the doctype instead of emitting it as text", () => {
		const md = htmlToMarkdown(
			"<!DOCTYPE html><html><body><main><p>Body copy</p></main></body></html>",
		);
		assert.ok(md.includes("Body copy"));
		assert.ok(!md.toLowerCase().includes("doctype"));
	});
	it("strips comments", () => {
		const md = htmlToMarkdown("<main><!-- secret --><p>Shown</p></main>");
		assert.ok(!md.includes("secret"));
		assert.ok(md.includes("Shown"));
	});
	it("drops data: URI images", () => {
		const md = htmlToMarkdown(
			"<main><p><img src='data:image/png;base64,iVBORw0KGgo='> Real <img src='/keep.png' alt='Keep'></p></main>",
			{ baseUrl: "https://e.com" },
		);
		assert.ok(!md.includes("data:"));
		assert.ok(!md.includes("base64"));
		assert.ok(md.includes("![Keep](https://e.com/keep.png)"));
	});
	it("does not emit emphasis markers for empty icon elements", () => {
		const md = htmlToMarkdown(
			"<main><p><a href='/dl'><i class='fab fa-android'></i>Download</a></p></main>",
			{ baseUrl: "https://e.com" },
		);
		assert.ok(md.includes("[Download](https://e.com/dl)"));
		assert.ok(!md.includes("**"));
		assert.ok(!md.includes("[*"));
	});
});
describe("analytics control surfaces", () => {
	const UA = "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
	const CHROME_UA =
		"Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
	function makeAnalytics(over: Record<string, unknown> = {}) {
		const sent: unknown[] = [];
		const analytics = new BeaconAnalytics({
			key: "sb_live_test_abc",
			host: "e.com",
			batchSize: 1,
			fetch: ((_url: string, init: RequestInit) => {
				sent.push(JSON.parse(String(init.body)));
				return Promise.resolve(new Response("{}", { status: 200 }));
			}) as unknown as typeof fetch,
			...over,
		});
		return { analytics, sent };
	}
	it("never sends ordinary traffic", async () => {
		const { analytics, sent } = makeAnalytics();
		analytics.record({
			path: "/",
			userAgent: CHROME_UA,
			fromBrowser: true,
		});
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(sent.length, 0);
	});
	it("sends classified crawler hits", async () => {
		const { analytics, sent } = makeAnalytics();
		analytics.record({ path: "/pricing", userAgent: UA, format: "markdown" });
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(sent.length, 1);
	});
	it("honours disableCategories", async () => {
		const { analytics, sent } = makeAnalytics({
			disableCategories: ["training"],
		});
		analytics.record({ path: "/", userAgent: UA });
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(sent.length, 0);
	});
	it("still fires onHit for a disabled category", () => {
		const seen: string[] = [];
		const { analytics } = makeAnalytics({
			disableCategories: ["training"],
			onHit: (
				_hit: unknown,
				match: {
					agent: string;
				},
			) => seen.push(match.agent),
		});
		analytics.record({ path: "/", userAgent: UA });
		assert.deepEqual(seen, ["GPTBot"]);
	});
	it("does not fire onHit for non-crawlers", () => {
		const seen: string[] = [];
		const { analytics } = makeAnalytics({
			onHit: (
				_hit: unknown,
				match: {
					agent: string;
				},
			) => seen.push(match.agent),
		});
		analytics.record({ path: "/", userAgent: CHROME_UA });
		assert.equal(seen.length, 0);
	});
	it("never throws into the request path when transport fails", async () => {
		const errors: unknown[] = [];
		const analytics = new BeaconAnalytics({
			key: "k",
			host: "e.com",
			batchSize: 1,
			fetch: (() =>
				Promise.reject(new Error("network down"))) as unknown as typeof fetch,
			onError: (e: unknown) => errors.push(e),
		});
		assert.doesNotThrow(() => analytics.record({ path: "/", userAgent: UA }));
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(errors.length, 1);
	});
});

const SITE_URL_WARNING = /siteUrl/;
describe("siteUrl guard", () => {
	const withNodeEnv = (value: string | undefined, fn: () => void): string[] => {
		const original = process.env.NODE_ENV;
		const originalWarn = console.warn;
		const warnings: string[] = [];
		console.warn = (...args: unknown[]) => {
			warnings.push(args.join(" "));
		};
		try {
			process.env.NODE_ENV = value;
			fn();
		} finally {
			process.env.NODE_ENV = original;
			console.warn = originalWarn;
		}
		return warnings;
	};
	const make = (siteUrl: string) => () => {
		createBeacon({ siteUrl, resolve: () => null });
	};
	it("warns on a loopback siteUrl in a production build", () => {
		for (const url of [
			"http://localhost:3000",
			"http://127.0.0.1:8080",
			"http://mac.local",
		]) {
			const warnings = withNodeEnv("production", make(url));
			assert.equal(warnings.length, 1, `expected a warning for ${url}`);
			assert.match(warnings[0] ?? "", SITE_URL_WARNING);
		}
	});
	it("stays quiet for a real origin, and in development", () => {
		assert.deepEqual(
			withNodeEnv("production", make("https://example.com")),
			[],
		);
		assert.deepEqual(
			withNodeEnv("development", make("http://localhost:3000")),
			[],
		);
	});
	it("never throws, so a bad siteUrl cannot take the site down", () => {
		withNodeEnv("production", () => {
			assert.doesNotThrow(make("http://localhost:3000"));
		});
	});
});
describe("analytics host derivation", () => {
	const hostFor = async (siteUrl: string): Promise<string> => {
		let body: {
			host: string;
		} | null = null;
		const beacon = createBeacon({
			siteUrl,
			resolve: () => "# x",
			analytics: {
				key: "k",
				batchSize: 1,
				fetch: ((_u: string, init: RequestInit) => {
					body = JSON.parse(String(init.body));
					return Promise.resolve(new Response("{}"));
				}) as unknown as typeof fetch,
			},
		});
		await beacon.handle(
			new Request(`${siteUrl}/p.md`, {
				headers: { "user-agent": "GPTBot/1.2", accept: "*/*" },
			}),
		);
		await new Promise((r) => setTimeout(r, 10));
		return (
			(
				body as {
					host: string;
				} | null
			)?.host ?? ""
		);
	};
	it("reports a bare hostname, dropping scheme and port", async () => {
		assert.equal(await hostFor("https://example.com"), "example.com");
		assert.equal(await hostFor("https://example.com:8443"), "example.com");
	});
	it("honours an explicit host override", async () => {
		let body: {
			host: string;
		} | null = null;
		const beacon = createBeacon({
			siteUrl: "https://example.com:8443",
			resolve: () => "# x",
			analytics: {
				key: "k",
				host: "canonical.example.com",
				batchSize: 1,
				fetch: ((_u: string, init: RequestInit) => {
					body = JSON.parse(String(init.body));
					return Promise.resolve(new Response("{}"));
				}) as unknown as typeof fetch,
			},
		});
		await beacon.handle(
			new Request("https://example.com:8443/p.md", {
				headers: { "user-agent": "GPTBot/1.2", accept: "*/*" },
			}),
		);
		await new Promise((r) => setTimeout(r, 10));
		assert.equal(
			(
				body as {
					host: string;
				} | null
			)?.host,
			"canonical.example.com",
		);
	});
});

describe("client ip resolution", () => {
	function ipFor(
		headers: Record<string, string>,
		getIp?: (request: Request) => string | null | undefined,
	): string | undefined {
		const hits: { ip?: string }[] = [];
		const beacon = createBeacon({
			siteUrl: "https://e.com",
			resolve: () => "# hi",
			...(getIp ? { getIp } : {}),
			analytics: {
				key: "sb_dev_t_1",
				onHit: (hit) => hits.push(hit),
				endpoint: "https://collector.invalid/hits",
			},
		});
		beacon.advertise(
			new Request("https://e.com/pricing", {
				headers: { "user-agent": "GPTBot/1.2", ...headers },
			}),
			new Response("<html></html>", { status: 200 }),
		);
		return hits[0]?.ip;
	}

	it("reads the CDN headers, including Fastly and Fly", () => {
		assert.equal(ipFor({ "fastly-client-ip": "203.0.113.7" }), "203.0.113.7");
		assert.equal(ipFor({ "fly-client-ip": "203.0.113.8" }), "203.0.113.8");
	});

	// x-forwarded-for is client-writable, so anything a CDN set itself wins.
	it("prefers a CDN header over x-forwarded-for", () => {
		assert.equal(
			ipFor({
				"x-forwarded-for": "198.51.100.1",
				"cf-connecting-ip": "203.0.113.9",
			}),
			"203.0.113.9",
		);
	});

	// Node hands out the mapped form on a dual-stack socket; only the bare v4
	// address matches an IPv4 CIDR, so verification depends on this.
	it("unwraps IPv4-mapped IPv6", () => {
		assert.equal(ipFor({ "x-real-ip": "::ffff:203.0.113.5" }), "203.0.113.5");
		assert.equal(
			ipFor({ "x-forwarded-for": "::ffff:203.0.113.6, 198.51.100.2" }),
			"203.0.113.6",
		);
	});

	it("lets getIp override the header chain, and falls back when it declines", () => {
		assert.equal(
			ipFor({ "cf-connecting-ip": "198.51.100.3" }, () => "203.0.113.10"),
			"203.0.113.10",
		);
		assert.equal(
			ipFor({ "cf-connecting-ip": "198.51.100.4" }, () => undefined),
			"198.51.100.4",
		);
	});

	it("reports nothing rather than a wrong address", () => {
		assert.equal(ipFor({}), undefined);
		assert.equal(ipFor({ "x-forwarded-for": "  ,  " }), undefined);
	});
});

describe("exists hook", () => {
	function beaconWith(
		exists: ((path: string) => boolean) | undefined,
		onResolve: () => void,
	) {
		return createBeacon({
			siteUrl: "https://e.com",
			resolve: () => {
				onResolve();
				return "# hi";
			},
			...(exists ? { exists } : {}),
		});
	}

	it("answers hasTwin without running the resolver", async () => {
		let resolves = 0;
		const beacon = beaconWith(
			() => true,
			() => {
				resolves += 1;
			},
		);
		assert.equal(
			await beacon.hasTwin("/pricing", new Request("https://e.com/pricing")),
			true,
		);
		assert.equal(resolves, 0);
	});

	it("falls back to the resolver when no exists is given", async () => {
		let resolves = 0;
		const beacon = beaconWith(undefined, () => {
			resolves += 1;
		});
		assert.equal(
			await beacon.hasTwin("/pricing", new Request("https://e.com/pricing")),
			true,
		);
		assert.equal(resolves, 1);
	});

	it("suppresses the alternate link when exists says no", async () => {
		let resolves = 0;
		const beacon = beaconWith(
			() => false,
			() => {
				resolves += 1;
			},
		);
		const out = await beacon.advertiseIfPresent(
			new Request("https://e.com/pricing"),
			new Response("<html></html>", { status: 200 }),
		);
		assert.equal(out.headers.get("link"), null);
		assert.equal(resolves, 0);
	});
});

describe("createFetchResolver", () => {
	function fetchStub(pages: Record<string, string>, seen: string[] = []) {
		return async (input: URL | RequestInfo, init?: RequestInit) => {
			const url = String(input);
			seen.push(
				String((init?.headers as Record<string, string>)?.[TWIN_FETCH_HEADER]),
			);
			const body = pages[new URL(url).pathname];
			return body === undefined
				? new Response("nope", { status: 404 })
				: new Response(body, {
						status: 200,
						headers: { "content-type": "text/html; charset=utf-8" },
					});
		};
	}

	it("converts the rendered page and marks its own fetch", async () => {
		const seen: string[] = [];
		const resolve = createFetchResolver({
			siteUrl: "https://e.com",
			fetch: fetchStub({ "/pricing": "<main><h1>Pricing</h1></main>" }, seen),
		});
		const md = await resolve(
			"/pricing",
			new Request("https://e.com/pricing.md"),
		);
		assert.match(String(md), /# Pricing/);
		assert.deepEqual(seen, ["1"]);
	});

	it("caches, so a second hit does not refetch", async () => {
		const seen: string[] = [];
		const resolve = createFetchResolver({
			siteUrl: "https://e.com",
			fetch: fetchStub({ "/a": "<main><h1>A</h1></main>" }, seen),
		});
		const req = new Request("https://e.com/a.md");
		await resolve("/a", req);
		await resolve("/a", req);
		assert.equal(seen.length, 1);
	});

	it("returns null for a missing page and for a non-HTML response", async () => {
		const resolve = createFetchResolver({
			siteUrl: "https://e.com",
			fetch: fetchStub({}),
		});
		assert.equal(
			await resolve("/gone", new Request("https://e.com/gone.md")),
			null,
		);

		const json = createFetchResolver({
			siteUrl: "https://e.com",
			fetch: async () =>
				new Response("{}", {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		});
		assert.equal(await json("/api", new Request("https://e.com/api.md")), null);
	});

	it("evicts oldest past maxEntries rather than growing forever", async () => {
		const seen: string[] = [];
		const resolve = createFetchResolver({
			siteUrl: "https://e.com",
			maxEntries: 2,
			fetch: fetchStub(
				{
					"/a": "<main>A</main>",
					"/b": "<main>B</main>",
					"/c": "<main>C</main>",
				},
				seen,
			),
		});
		const r = new Request("https://e.com/x.md");
		await resolve("/a", r);
		await resolve("/b", r);
		await resolve("/c", r); // evicts /a
		await resolve("/a", r); // must refetch
		assert.equal(seen.length, 4);
	});

	it("does not cache a network failure", async () => {
		let calls = 0;
		const resolve = createFetchResolver({
			siteUrl: "https://e.com",
			fetch: async () => {
				calls += 1;
				throw new Error("boom");
			},
		});
		const r = new Request("https://e.com/a.md");
		assert.equal(await resolve("/a", r), null);
		assert.equal(await resolve("/a", r), null);
		assert.equal(calls, 2);
	});
});
