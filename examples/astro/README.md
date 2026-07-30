# Astro + beacon

The shortest integration there is, because `createFetchMiddleware` returns
exactly Astro's middleware signature:

```ts
// src/middleware.ts
export const onRequest = createFetchMiddleware(beacon);
```

That is the entire wiring. Every other framework needs a line or two to bridge
its own shape - Astro is the one that matches.

```bash
pnpm install
pnpm build      # astro build, then beacon build over dist/
pnpm preview
```

```bash
curl -H 'Accept: text/markdown' http://localhost:4321/
curl http://localhost:4321/index.md
curl http://localhost:4321/llms.txt
```

## Twins are files here

Unlike the Next.js example, this uses `dir: "dist"`. `beacon build` walks the
built HTML and writes a `.md` next to each page, plus `llms.txt` and
`sitemap-md.xml`. Look in `dist` after a build.

Order matters: `astro build` first, then `beacon build`. The `build` script
already chains them.

In CI, add `beacon build dist --site-url ... --check`. It exits non-zero when a
twin is stale, which catches the case where someone edits a page and the twins
ship a version behind.

## Static hosting

`output: "static"` means the twins are just files on disk, so Netlify, Vercel,
S3 or GitHub Pages serve `/pricing.md` with no runtime at all. The middleware
adds what a static host cannot: `Accept: text/markdown` on the canonical URL,
the `Link: rel="alternate"` advertisement, and reporting. Add an adapter and it
runs on request.
