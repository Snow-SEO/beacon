# @snowseo/beacon

Serve Markdown twins to AI crawlers, make them discoverable, and measure which crawlers actually arrive.

Two jobs, one package:

1. **Serve** a clean Markdown copy of every page, both at `<page>.md` and on the canonical URL via `Accept: text/markdown`.
2. **Measure** which AI crawlers fetched what, and whether they took the Markdown or the HTML.

The serving half works standalone with no account. The analytics half activates when you add a site key -
pointed at SnowSEO by default, or at [your own collector](#analytics) if you would rather keep the data.

## Install

```bash
npm install @snowseo/beacon
```

## How it works

Twins are generated **at build time**, not converted per request. The CLI reads your build output, writes a
`.md` beside every HTML page, and writes `llms.txt` and `sitemap-md.xml`. The runtime half then only has to
answer `Accept: text/markdown` on the canonical URL and advertise the twin - it never converts anything.

That split is deliberate. Runtime conversion means every request pays for a parse, and on a client-rendered
app it converts the empty shell: you ship a twin containing a title and nothing else, which reads as a
working install while telling every crawler your page is blank. Generating at build time makes that failure
loud instead of silent - `beacon build` refuses to write an empty twin and exits non-zero if every page is
empty.

## 1. Generate the twins

```bash
npx beacon build dist --site-url https://example.com
```

```
beacon build dist -> https://example.com

  wrote index.md                        1204 tokens
  wrote pricing.md                       318 tokens
  wrote docs/getting-started.md          876 tokens
  wrote llms.txt
  wrote sitemap-md.xml

3 twin(s), 0 page(s) with no content, 0 excluded
```

Add it after your normal build:

```json
{
  "scripts": {
    "build": "astro build && beacon build dist --site-url https://example.com"
  }
}
```

The output directory depends on the framework: `dist` for Astro, Vite and SvelteKit, `out` for
`next build` with `output: "export"`, `.output/public` for Nuxt.

| Flag | |
| --- | --- |
| `--site-url <url>` | Public origin. Required. |
| `--check` | Write nothing; exit 1 if any twin is out of date. For CI. |
| `--exclude <prefix>` | Route prefix to skip. Repeatable. |
| `--name` / `--summary` | Site name and one-liner for `llms.txt`. |
| `--min-content-chars <n>` | Below this much prose, a page counts as empty (24). |
| `--no-llms-txt` / `--no-sitemap` | Skip those files. |
| `--no-extract-main` | Convert the whole `<body>`, not just `<article>`/`<main>`. |

`--extract-main` is on by default, so navigation, footers and cookie banners never reach the twin.

### If every page converts to nothing

```
Every page converted to nothing.
  This build ships an empty HTML body, so AI crawlers and search engines
  see nothing either - the twin is not the problem to fix first.
  Prerender or server-render your routes, then run this again.
```

This is a client-rendered build: the HTML is a `<div id="root"></div>` and the content only appears after
JavaScript runs. Beacon will not paper over it, because the same emptiness is what Google and every AI
crawler see. Prerender the routes (`@astrojs/`-style SSG, Next's `output: "export"`, `vite-plugin-ssr`,
`react-snap`) and run the build again.

## 2. Serve them

```ts
import { createBeacon } from "@snowseo/beacon";

export const beacon = createBeacon({
  siteUrl: "https://example.com",
  dir: "dist",  // the same directory you ran `beacon build` on
});
```

That is the whole configuration. `dir` reads the twins the CLI wrote, so there is no route table to keep in
sync with your pages.

`siteUrl` must be your real public origin. Every self-referencing URL is built from it: the twin's
`rel="canonical"`, `sitemap-md.xml`, and the robots.txt `Sitemap:` line. If it falls back to
`http://localhost:3000` because an environment variable is unset, each twin will tell Google and every AI
crawler that its authoritative copy lives on a host they cannot reach. Beacon logs a warning when it sees a
loopback `siteUrl` in a production build, but it cannot detect a merely wrong one.

**A purely static host needs no runtime at all.** Netlify, Vercel static, S3, GitHub Pages and Cloudflare
Pages already serve `/pricing.md` as a file once `beacon build` has written it, and `llms.txt` and
`sitemap-md.xml` alongside. The runtime half adds `Accept: text/markdown` on the canonical URL, the
`Link: rel="alternate"` advertisement, and analytics.

### Astro

`createFetchMiddleware` returns `(context, next) => Promise<Response>`, which is Astro's middleware
signature exactly. Export it and you are done:

```ts
// src/middleware.ts
import { createFetchMiddleware } from "@snowseo/beacon";
import { beacon } from "./beacon";

export const onRequest = createFetchMiddleware(beacon);
```

### SvelteKit, Hono, Workers, Deno, Bun

Same middleware, but each of these calls middleware its own way, so it needs a line or two to hand over
the request. Do **not** export it directly - the framework will never call it, and nothing will warn you.

```ts
// SvelteKit: src/hooks.server.ts
const middleware = createFetchMiddleware(beacon);

export const handle: Handle = ({ event, resolve }) =>
  middleware({ request: event.request }, () => resolve(event));
```

```ts
// Workers, Deno, Bun: wrap the fetch handler
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return middleware(
      { request, waitUntil: (p) => ctx.waitUntil(p) },
      () => handleRequest(request, env),
    );
  },
};
```

Hono's `next()` resolves to `void` rather than a `Response`, so read the response back off the context:

```ts
app.use(async (c, next) => {
  c.res = await middleware({ request: c.req.raw }, async () => {
    await next();
    return c.res;
  });
});
```

### Nuxt

Nitro middleware runs before the route handler and cannot wrap its response, so `createFetchMiddleware`
does not fit. Serving twins and reporting hits work through `beacon.handle` and `beacon.track` in
`server/middleware/`; the `Link: rel="alternate"` advertisement has to be set by hand. See the
[install guide](https://snowseo.com/docs/beacon/install/fetch-frameworks#nuxt).

### Next.js

```ts
// proxy.ts, or middleware.ts before Next 16
import { beaconMiddleware, beaconAdvertise } from "@snowseo/beacon/next";

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  const markdown = await beaconMiddleware(beacon, request, event);
  if (markdown) return markdown;

  return beaconAdvertise(beacon, request, NextResponse.next(), event);
}
```

Next rewrites `Vary` on every document response for its own RSC cache, which
drops the `Vary: Accept` the middleware added. The markdown responses keep it,
so Next's own cache is fine, but a shared CDN in front of Next could serve a
cached HTML page to a client that asked for markdown. If that matters to you,
add `Accept` to the CDN's cache key, or rely on the `.md` URLs, which are
distinct URLs and need no `Vary` at all.

### Express

```ts
import { beaconExpress } from "@snowseo/beacon/node";
app.use(beaconExpress(beacon));
```

### Twins from a CMS or database

When the markdown does not live in a directory, supply `resolve` instead of `dir`:

```ts
createBeacon({
  siteUrl: "https://example.com",
  resolve: async (path) => {
    const post = await getPost(path);
    return post ? post.markdown : null;  // null -> serve normal HTML
  },
});
```

## What gets served

```http
GET /pricing
Accept: text/markdown

200 OK
Content-Type: text/markdown; charset=utf-8
Vary: Accept
X-Robots-Tag: index, follow
X-Markdown-Tokens: 412
Content-Signal: ai-train=yes, search=yes, ai-input=yes
```

```http
GET /pricing.md

200 OK
Content-Type: text/markdown; charset=utf-8
Link: <https://example.com/pricing>; rel="canonical"
X-Robots-Tag: index, follow
```

And the HTML page advertises its twin:

```http
Link: </pricing.md>; rel="alternate"; type="text/markdown"
Vary: Accept
```

The alternate is relative and the canonical is absolute, on purpose. RFC 8288 resolves a relative target
against the request URL, so the client rebuilds it from the origin it actually asked for. That is right on a
preview deploy, right behind a reverse proxy (where the server's own `request.url` is the internal bind
address), and unspoofable, since no forwarded header is consulted. The canonical has the opposite job -
naming the one origin that should rank - so it stays absolute and comes from `siteUrl`.

### Only pages with twins are advertised

A page with no twin gets no `Link: rel="alternate"`, and a markdown request for it falls through to the
normal HTML response rather than 404ing. An unmapped page is never hidden from a crawler that asked
politely, and a crawler is never pointed at a `.md` URL that does not exist.

### Never negotiated on User-Agent

The twin is served on `Accept: text/markdown` and on the `.md` URL. Never on who is asking. Serving
different content to a crawler than to a browser based on its User-Agent is cloaking, and Google says so
explicitly. Everything here is available to any client that sends the header.

### Why `index, follow` and not `noindex`

The AEO v1.0 spec makes `X-Robots-Tag: noindex` on twins a MUST. We deliberately do not.

`noindex` is the documented opt-out from ChatGPT surfacing, so putting it on a twin throws away the exact crawl the twin exists to attract. Cloudflare's own edge implementation serves twins as `index, follow`. Duplicate content is solved properly with `Link: rel="canonical"`, which keeps the twin crawlable while ranking consolidates onto the HTML page. Google documents that header for non-HTML documents.

If you want `noindex` anyway, pass it explicitly via `headers`. We just will not do it to you by default.

## Discovery

`beacon build` writes `llms.txt` and `sitemap-md.xml` into the output directory, so on a static host there is
nothing else to do. Reference the twin sitemap from `robots.txt`:

```
Sitemap: https://example.com/sitemap-md.xml
```

Twins go in their own sitemap on purpose: doubling URLs in your primary sitemap is a real crawl-budget cost
on a large site, and keeping them separate means you can measure and revert the change on its own.

If you generate those files dynamically instead - a CMS with `resolve`, say - build them at runtime:

```ts
// app/sitemap-md.xml/route.ts
export async function GET() {
  return beacon.sitemap(await getAllPostPaths());
}

// app/llms.txt/route.ts
export async function GET() {
  return beacon.llmsTxt({
    name: "Example",
    summary: "What the product does, in one line.",
    sections: [
      {
        title: "Docs",
        links: [{ title: "Getting started", url: "https://example.com/docs.md" }],
      },
    ],
  });
}
```

```ts
beacon.robotsDirective(); // "Sitemap: https://example.com/sitemap-md.xml"
```

## Analytics

```ts
const beacon = createBeacon({
  siteUrl: "https://example.com",
  dir: "dist",
  analytics: { key: process.env.SNOWSEO_BEACON_KEY! },
});
```

Never expose that key to the browser. It authenticates writes for your whole site, so on Vite, Astro or
Next it must **not** carry a `VITE_` or `NEXT_PUBLIC_` prefix - those are inlined into the client bundle,
which publishes the key.

For hosted SnowSEO, omit `endpoint` entirely - the default already points at it.

Set it to reach your own collector. It may be a bare origin, in which case the
ingest path is appended for you, so both of these are the same thing:

```ts
endpoint: "https://beacon.example.com"
endpoint: "https://beacon.example.com/beacon/hits"
```

An `endpoint` that already names a path is left exactly as written, which is how
you point at a route of your own.

You keep control of this half:

```ts
analytics: {
  key: process.env.SNOWSEO_BEACON_KEY!,
  endpoint: "https://collector.yourcompany.com/hits",  // send it somewhere else
  disableCategories: ["training"],                     // report only what you want
  onHit: (hit, match) => log.info(match.agent, hit.path), // tee into your own logs
  onError: (error) => log.warn(error),                 // default: one warning per message
}
```

A rejected batch is reported through `onError` rather than swallowed. `fetch` only rejects on transport
failure, so without this a 404 from a misconfigured endpoint is indistinguishable from a successful send -
the dashboard just stays empty forever.

### Running your own collector

`endpoint` is not decoration. If you would rather not send this traffic to SnowSEO, don't:

```bash
BEACON_KEYS=$(openssl rand -hex 24) npx @snowseo/beacon-server
```

Point `endpoint` at it and the hits go there instead. `@snowseo/beacon-server` is MIT, does the same
classification and verification production does, and stores to SQLite or Postgres. The wire contract is
frozen and documented, so a collector you write yourself is equally valid - see
[PROTOCOL.md](https://github.com/Snow-SEO/beacon/blob/main/packages/beacon-server/PROTOCOL.md).

Hits are sent to the collector as a single JSON POST authenticated with an `X-Beacon-Key` header, not
`Authorization` - the key identifies a site rather than a user, and it has to survive proxies that strip
auth headers. The body is `{ host, hits[] }`, where each hit carries exactly `path`, `userAgent`, `format`,
`statusCode`, `referrer`, `ip`, `occurredAt`, `askedForMarkdown` and `fromBrowser`, plus `method`, `rawPath`,
`signature`, `signatureInput` and `signatureAgent` when the request arrived with Web Bot Auth headers.
`host` is a bare hostname derived from `siteUrl` - `example.com`, never `https://example.com` and never
`example.com:8443` - so a wrong `siteUrl` mis-attributes every hit. Override it with `analytics.host` if you
serve one site from several origins. Nothing else is collected. Against SnowSEO, IPs are hashed on receipt
and raw addresses are never retained; against your own collector, that is your call.

Markdown hits carry `statusCode`, HTML hits usually do not. That is not an oversight. `advertise()` is handed
a passthrough response - `NextResponse.next()`, or an Express `res` before the route ran - whose 200 is a
default rather than the page's real status, so reading it would report every 404 as a 200. Do not pass
`response.status` through `ctx` to close the gap; supply `ctx.statusCode` only where you have the genuine
post-route status. `createFetchMiddleware` does have it, and passes it.

Ordinary browser traffic never leaves your server: a request carrying a `Sec-Fetch-*` header, with no
markdown interest and no registry match, is dropped locally and never queued. That is the high-volume case,
and it keeps human page views off the wire entirely.

Everything else is forwarded and classified by the collector, not here. Requiring a local registry match
before reporting would make the installed SDK version a ceiling on what a site can ever see - a crawler
added to the registry after your last upgrade would stay invisible until you reinstalled. Classification
server-side means the taxonomy improves without anyone touching their dependencies.

The bundled registry is still used locally, for `disableCategories` and `onHit`. It matches documented
user-agent tokens only, never vendor-name substrings, so a script that merely mentions a vendor is not
counted as a crawler.

```ts
import { classifyAICrawler } from "@snowseo/beacon";

classifyAICrawler("Mozilla/5.0 ... ChatGPT-User/1.0");
// { provider: "OpenAI", agent: "ChatGPT-User", category: "answer_fetch" }
```

`answer_fetch` is the category to watch: those hits are triggered by a real person whose assistant is reading your page to answer them right now.

A request that asks for `text/markdown` is recorded even when its User-Agent matches nothing. Coding agents
travel under generic HTTP-client identities - Claude Code sends `axios/1.8.4` - and they are today the
largest source of real markdown negotiation. Dropping them would hide the traffic the twins exist for.

## HTML to Markdown

The converter the CLI uses is exported, if you want it directly:

```ts
import { htmlToMarkdown } from "@snowseo/beacon";

const markdown = htmlToMarkdown(html, { baseUrl, extractMain: true });
```

Dependency-free and runs on edge runtimes.

## What this package does not do

It does not audit, score, or grade your site. Serving twins and reporting crawlers is the whole surface.
Diagnosis lives in the SnowSEO dashboard, which is also where crawler hits become citations, crawl-to-refer
ratios, and per-page attribution.

## Works alongside Cloudflare

If your zone has Cloudflare's *Markdown for Agents* enabled, keep it. Cloudflare converts at the edge but publishes no `.md` URLs, no `Link: rel="alternate"`, no sitemap and no `llms.txt`. Beacon adds the discovery layer and the measurement, and its headers are compatible.

## License

[MIT](https://github.com/Snow-SEO/beacon/blob/main/packages/beacon/LICENSE.md).
