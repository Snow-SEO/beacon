# beacon

Make your site legible to AI crawlers, and find out which ones actually came.

Beacon does two things. It serves a clean Markdown twin of every page to clients
that ask for one, and it reports what visited - which crawler, from where, and
whether the User-Agent was telling the truth.

MIT licensed. It ships with a server you can run yourself, so none of this has
to go through anyone else's platform.

## Packages

| Package | What it is |
| --- | --- |
| [`@snowseo/beacon`](packages/beacon) | The client. Generates Markdown twins, serves them by content negotiation, reports hits. Node, Next.js, Workers, Deno, Bun, or any `fetch`-based framework. |
| [`@snowseo/beacon-server`](packages/beacon-server) | The receiving half. Crawler verification (published IP ranges, datacenter detection, reverse DNS, Web Bot Auth) plus a reference ingest server. |

## Quick start

```bash
npm install @snowseo/beacon
npx beacon build dist
```

That writes a `.md` twin next to every HTML page. Then serve them:

```ts
import { createBeacon } from "@snowseo/beacon";

const beacon = createBeacon({ siteUrl: "https://example.com", dir: "dist" });
```

Full instructions for Next.js, Express, Cloudflare Workers, Astro, Deno and Bun
are in [`packages/beacon`](packages/beacon).

**PHP and WordPress** are served by a separate client that speaks the same
protocol: one `auto_prepend_file` line, no application code touched. It lives
with the [WordPress plugin](https://github.com/Snow-SEO/snowseo-wordpress-plugin),
which is what it is built into.

## Running your own collector

The analytics half is not tied to any hosted service. Point it wherever you
like:

```bash
BEACON_KEYS=$(openssl rand -hex 24) npx @snowseo/beacon-server
# [beacon] listening on http://0.0.0.0:8787/v3/beacon/hits
```

```ts
createBeacon({
  siteUrl: "https://example.com",
  dir: "dist",
  analytics: { key: "...", endpoint: "https://beacon.example.com" },
});
```

Two routes, no more: `POST /v3/beacon/hits` and `GET /health`. It classifies and
verifies exactly as the hosted service does - the same `ingestBatch` function
runs in both - and stores to SQLite or Postgres.

The wire contract is frozen and documented in
[PROTOCOL.md](packages/beacon-server/PROTOCOL.md), so writing your own collector
in another language is a supported path, not a hack.

## Why the server half exists at all

A User-Agent is a claim, and it costs nothing to forge. Beacon's client
deliberately draws no conclusions: it reports raw facts and lets the server
decide, because a client that graded its own traffic would just be repeating
what the crawler told it.

Verification uses three signals, weakest to strongest:

- **Published IP ranges.** Providers publish the addresses their crawlers use.
- **Reverse DNS.** A PTR under an authenticating suffix, forward-confirmed.
- **Web Bot Auth.** An RFC 9421 signature. The only one that is proof rather
  than inference.

Results land in four states - `signed`, `verified`, `unverified`,
`spoofed_suspected`. `unverified` means there was nothing to check against;
`spoofed_suspected` means something checkable contradicts the claim. Keeping
those apart matters more than it sounds: collapsed together, "we could not tell"
becomes an accusation.

## Contributing

This is where beacon is developed. Issues and pull requests are read and merged
here, and the npm packages are published from this repository's tags.

The most common contribution by far is a crawler we do not recognise yet. See
[CONTRIBUTING.md](CONTRIBUTING.md) for what a registry entry needs, and for
running the suites - including the real Apache end-to-end run.

## Hosted SnowSEO

[SnowSEO](https://snowseo.com) runs this same code and adds the parts that are
not in this repository: a dashboard, a maintained verified-crawler dataset,
attribution from crawl to citation, and history. Using it is optional - beacon
works completely without it.

## License

[MIT](LICENSE.md).
