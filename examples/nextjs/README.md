# Next.js + beacon

App Router, twins served from a content source rather than a directory, and an
`llms.txt` route generated from that same source.

```bash
pnpm install
pnpm dev
```

```bash
curl -H 'Accept: text/markdown' http://localhost:3000/
curl http://localhost:3000/index.md
curl -i http://localhost:3000/ | grep -i '^link:'
curl http://localhost:3000/llms.txt
```

## Why there is no `dir`

App Router pages are React components, not a directory of HTML files, so there
is nothing for `beacon build` to convert at the point the middleware runs. The
twins come from `src/lib/content.ts` through a `resolve` function - stand-in for
a CMS, a database, or your MDX frontmatter.

`resolve` returning `null` means "no twin here", and the request falls through
to normal HTML. That is deliberately the safe answer: an unmapped page serves
its page rather than 404ing a crawler.

`llms.txt` reads the same array, so it cannot advertise a page that does not
exist.

## Next 15 vs 16

This example pins Next 15, so the file is `src/middleware.ts`. On Next 16+
rename it to `src/proxy.ts` and rename the export to `proxy`.

Getting this wrong fails silently: Next simply does not register the file, the
build succeeds, and no twin is ever served. Check
`.next/server/middleware-manifest.json` has an entry if you are unsure.

## Reporting

Twin serving works with no key. Set one to turn reporting on:

```bash
SNOWSEO_BEACON_KEY=sb_live_...
BEACON_ENDPOINT=http://127.0.0.1:8787   # your own collector, or omit for SnowSEO
```

Note `beaconAdvertise` is passed `event`. That carries `waitUntil`, so a report
in flight is not killed when the response returns.
