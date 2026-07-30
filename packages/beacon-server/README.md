# @snowseo/beacon-server

The receiving half of beacon: crawler verification, plus a reference ingest
server you can run instead of sending your traffic to SnowSEO.

Server-side crawler verification for beacon hits. The half of AI-crawler
tracking that cannot live on the site being crawled.

[`@snowseo/beacon`](https://github.com/Snow-SEO/beacon/tree/main/packages/beacon) runs on your web server and reports raw facts
about a request: the User-Agent, the source IP, whether markdown was negotiated,
whether Web Bot Auth headers were present. It deliberately draws no conclusions.
This package draws them.

That split is the point. A client that decided its own verdict could simply
assert it, and a registry compiled into a site's dependencies goes stale the day
after it is installed.

## What it does

Three signals, weakest to strongest:

| Signal | Mechanism | Verdict |
| --- | --- | --- |
| Published IP ranges | CIDR match against provider feeds, in memory | `verified` / `spoofed_suspected` |
| Reverse DNS | PTR under an authenticating suffix, forward-confirmed | `verified` / `spoofed_suspected` |
| Web Bot Auth | RFC 9421 Ed25519 signature against a published key directory | `signed` |

A User-Agent is a claim. An IP is a claim about infrastructure. Only a signature
is proof, and only it survives an agent egressing through a proxy pool that
appears in no feed.

```ts
import {
  verifyCrawlerIpSync,
  verifyWebBotAuth,
  warmCrawlerRangesInBackground,
} from "@snowseo/beacon-server";

warmCrawlerRangesInBackground();

verifyCrawlerIpSync("20.171.207.1", "OpenAI");
// { verified: true, state: "verified", method: "cidr" }
```

`verifyCrawlerIpSync` never does I/O, so it is safe in an ingest hot path.
Reverse DNS (`verifyByReverseDns`) is async and belongs on a queue: a DNS
round-trip per hit would be far too slow for a 500-hit batch.

## Four states, not two

`spoofed_suspected` is not a louder `unverified`. It means something checkable
actively contradicts the claim - the provider publishes ranges this address is
absent from, or the address belongs to a *different* provider. `unverified`
means there was nothing to check against yet. Collapsing them would let a
scanner wearing the UA of a provider with no published feed sit in a quieter
bucket than the same scanner wearing OpenAI's.

## Outbound requests

Every fetch goes through an SSRF-safe implementation by default. This is not
belt-and-braces: `verifyWebBotAuth` resolves a key directory whose URL comes
from a request header, so an unguarded fetch would turn every signed hit into an
SSRF primitive.

Host applications that already have a guard can supply it and keep one
implementation in play:

```ts
import { setFetchImplementation } from "@snowseo/beacon-server";

setFetchImplementation(myGuardedFetch);
```

## Range data

Provider feeds are fetched at boot and refreshed on a schedule, cached in
process. Providers who publish an ASN instead of a feed resolve through the
[ipverse](https://github.com/ipverse/asn-ip) dataset, as does the datacenter
index used to decide whether a browser-shaped request could have had a person
behind it.

A CIDR miss is treated as evidence of forgery only where the feed is maintained
well enough to argue from; see `LOW_CONFIDENCE_RANGES` in `crawler-ranges.ts`.

## Running your own ingest server

Beacon clients are not tied to SnowSEO. Point `endpoint` at your own host and the
hits go there instead:

```bash
BEACON_KEYS=$(openssl rand -hex 24) npx @snowseo/beacon-server
# [beacon] listening on http://0.0.0.0:8787/v3/beacon/hits (1 key(s), ip mode: hash)
```

Then configure the client with that origin and key:

```ts
createBeacon({
  key: "the key you generated",
  endpoint: "https://beacon.example.com",
});
```

```php
define('SNOWSEO_BEACON_ENDPOINT', 'https://beacon.example.com');
define('SNOWSEO_BEACON_KEY', 'the key you generated');
```

Two routes, no more: `POST /v3/beacon/hits` and `GET /health`. Dashboards, stats
APIs and attribution are not part of it - the server records classified,
verified hits, and what you do with them is yours. The full wire contract is in
[PROTOCOL.md](https://github.com/Snow-SEO/beacon/blob/main/packages/beacon-server/PROTOCOL.md).

### Docker

```bash
BEACON_KEYS=$(openssl rand -hex 24) docker compose up -d
```

The [compose file](https://github.com/Snow-SEO/beacon/blob/main/packages/beacon-server/docker-compose.yml) runs SQLite on a volume by default and
has a `postgres` profile.

### Configuration

| Variable               | Default      | Meaning                                                             |
| ---------------------- | ------------ | ------------------------------------------------------------------- |
| `BEACON_KEYS`          | required     | Ingest keys, whitespace- or `;`-separated. `key@host,host` scopes one to specific sites, with `*.example.com` wildcards. |
| `PORT` / `HOST`        | `8787` / `0.0.0.0` |                                                               |
| `BEACON_STORE`         | `sqlite`     | `sqlite`, `postgres` or `memory`.                                   |
| `BEACON_SQLITE_PATH`   | `beacon.db`  |                                                                     |
| `BEACON_POSTGRES_URL`  | `DATABASE_URL` | Needed for `BEACON_STORE=postgres`. Also `npm install pg`.        |
| `BEACON_IP_MODE`       | `hash`       | `hash`, `raw` or `discard`. See below.                              |
| `BEACON_IP_SALT`       | random       | Set it, or hashes change on every restart.                          |
| `BEACON_MAX_BODY_BYTES`| `4194304`    |                                                                     |

The SQLite store uses Node's built-in `node:sqlite`, so there is nothing to
compile - the cost is needing Node 24, or Node 22.5+ with
`--experimental-sqlite`. `pg` is an optional peer dependency, imported only if
you choose the Postgres store.

There is no rate limiting and no TLS. Put it behind a reverse proxy.

### Addresses

Verification runs against the raw address, because that is the one part of a
request a crawler cannot dress up. What gets *persisted* is up to you:
`hash` (HMAC-SHA256, the default, and what SnowSEO does), `raw`, or `discard`.
Deferred reverse-DNS holds the raw address in memory only for the length of the
lookup.

### Embedding it instead

The pipeline is exported on its own, so you can run classification inside an app
you already have and persist however you like. This is what SnowSEO does:
`ingestBatch` is the same function in production and in the reference server, so
the open half cannot quietly diverge from the hosted one.

```ts
import { ingestBatch, runDeferredVerification } from "@snowseo/beacon-server";

const result = await ingestBatch(host, hits);
await myStore.save(result.rows, result.rollups);
```

Implement `HitStore` to plug in your own persistence, or subclass one of
`SqliteHitStore`, `PostgresHitStore` and `MemoryHitStore`.

## License

[MIT](https://github.com/Snow-SEO/beacon/blob/main/packages/beacon-server/LICENSE.md).
