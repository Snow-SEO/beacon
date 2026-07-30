# Self-hosted beacon

An Express site that serves Markdown twins and reports crawler hits to a
collector **you** run. Nothing here talks to SnowSEO, and no account is
involved.

This is the example worth reading if you want to know what the open half
actually gives you.

## Run it

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Two processes come up: the collector on `:8787` and the site on `:3000`. Then,
in another terminal:

```bash
# A registered crawler. Classified as OpenAI / GPTBot / training.
curl -A 'GPTBot/1.2' http://localhost:3000/

# Ask for the twin. Same URL, different representation.
curl -H 'Accept: text/markdown' http://localhost:3000/

# The twin by its own URL.
curl http://localhost:3000/index.md

# An ordinary browser. Recorded by nothing - this is the point.
curl -A 'Mozilla/5.0' -H 'Sec-Fetch-Mode: navigate' http://localhost:3000/
```

The site logs each hit it reports. The collector logs anything it drops.

## Look at what was stored

```bash
sqlite3 beacon.db 'SELECT occurred_at, provider, agent, path, verify_state FROM beacon_hits;'
sqlite3 beacon.db 'SELECT * FROM beacon_daily_stats;'
```

Two things to notice, and the second one matters in production.

**`verify_state` is `unverified`, not `verified`.** `unverified` means "nothing
to check against". It is not `spoofed_suspected`, which would mean the evidence
contradicts the claim. Keeping those apart is the whole point of having four
states rather than a boolean.

**`ip` is `null`.** Not hashed - absent. The client derives the address from
forwarded headers (`X-Forwarded-For`, `CF-Connecting-IP` and friends), and a
direct connection to localhost sets none of them. No address means nothing to
verify, which is why the row above says `unverified`.

That is not a quirk of this example. **A Node site reached directly, with no
proxy in front, reports no address at all**, so every hit stays `unverified`
forever. In production you are almost always behind nginx, Caddy, a load
balancer or Cloudflare, all of which set `X-Forwarded-For`. If you are not, put
something in front that does, or accept that verification cannot work.

Once an address does arrive, `BEACON_IP_MODE` decides what is kept:
verification always runs against the raw value first, then `hash` (the default)
stores an HMAC, `raw` stores the address, `discard` stores nothing.

To see it work, fake the header:

```bash
curl -A 'GPTBot/1.2' -H 'X-Forwarded-For: 20.171.207.9' http://localhost:3000/
```

That address is in OpenAI's published range, so the row comes back `verified` by
`cidr` - and `ip` is a 32-character hash rather than the address you sent.

## How the pieces fit

```
site (:3000)                         collector (:8787)
  beaconExpress(beacon)                POST /v3/beacon/hits
    serves site/*.md                     classify user agent
    advertises Link: rel=alternate       verify IP against provider ranges
    reports hits ─────────────────────►  check Web Bot Auth signature
                                         store hit + daily rollup
```

The client sends raw facts - path, user agent, address, whether Markdown was
negotiated. It never decides what they mean. That happens in the collector,
which is why the crawler registry can improve without you upgrading the site.

## The twins

`pnpm build:twins` runs `beacon build site --site-url http://localhost:3000`,
which writes a `.md` next to every `.html`, plus `llms.txt` and
`sitemap-md.xml`. Look at `site/index.md` after running it.

In a real project this belongs in your build, after whatever generates the HTML.
`beacon build --check` exits non-zero if a twin is stale, which is what you want
in CI.

## Pointing it at something real

Change one variable:

```bash
BEACON_ENDPOINT=https://beacon.your-company.com
```

Or drop `endpoint` entirely to report to SnowSEO. The client does not care - it
is the same wire format either way, and it is documented in
[PROTOCOL.md](../../packages/beacon-server/PROTOCOL.md).
