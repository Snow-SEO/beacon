# The beacon wire protocol

Version 1. Every beacon client - the JavaScript SDK, the PHP core, the WordPress
plugin - speaks this. Any server that implements it can receive their traffic;
`@snowseo/beacon-server` is the reference implementation, and hosted SnowSEO
implements the same contract.

This document is normative. Fields are added, never removed or repurposed.

---

## Transport

```
POST <endpoint>
X-Beacon-Key: <key>
Content-Type: application/json
```

`<endpoint>` is whatever the client is configured with. If it is a bare origin,
clients append `/v3/beacon/hits`, so `https://beacon.example.com` and
`https://beacon.example.com/v3/beacon/hits` are equivalent.

Requests are server-to-server. Nothing about beacon runs in a visitor's browser,
and no cookie or visitor identifier is ever involved.

## Request body

```jsonc
{
  "host": "example.com",
  "hits": [ /* 1 to 500 items */ ]
}
```

`host` is the site the hits belong to: at most 255 characters, no scheme, and
compared case-insensitively with `www.` and any port stripped.

### Hit fields

| Field              | Type                        | Notes                                                          |
| ------------------ | --------------------------- | -------------------------------------------------------------- |
| `path`             | string, required            | Request path. Truncated to 2048 characters.                     |
| `userAgent`        | string, required            | Raw, unparsed. Truncated to 512 characters.                     |
| `format`           | `"markdown"` \| `"html"`    | What was served.                                                |
| `statusCode`       | integer                     | Response status.                                                |
| `referrer`         | string                      | Referer header, if any.                                         |
| `ip`               | string                      | Source address, v4 or v6. See [Addresses](#addresses).          |
| `occurredAt`       | string                      | ISO 8601. See [Clocks](#clocks).                                |
| `askedForMarkdown` | boolean                     | Client negotiated markdown, by `Accept` or by a `.md` URL.      |
| `fromBrowser`      | boolean                     | A `Sec-Fetch-*` header was present.                             |
| `method`           | string                      | HTTP method. Only needed for signature verification.            |
| `rawPath`          | string                      | Path with query string, exactly as received. Signatures only.   |
| `signature`        | string                      | RFC 9421 `Signature` header, verbatim.                          |
| `signatureInput`   | string                      | RFC 9421 `Signature-Input` header, verbatim.                    |
| `signatureAgent`   | string                      | `Signature-Agent` header, verbatim.                             |
| `headers`          | object of string to string  | Lowercase-keyed subset of raw request headers.                  |

Only `path` and `userAgent` are required. A hit missing either is dropped and
counted as `malformed`; the rest of the batch still lands. Servers MUST NOT
reject a whole batch over one bad item.

`headers` carries the raw bytes for a fixed client-side allow-list, so
classification can improve without every install upgrading first. Servers MUST
tolerate unknown keys.

### Classification is the server's job

Clients send raw facts. They do not label a hit as a crawler, name a provider,
or claim a verification state - a client-supplied verdict would be self-reported
and worthless. Clients MAY drop obvious non-traffic locally (empty user agents,
their own health checks).

## Response

`200 OK`:

```json
{
  "accepted": 2,
  "skipped": 1,
  "reasons": { "malformed": 0, "unrecognized": 1 }
}
```

- `accepted` - hits recorded.
- `skipped` - `hits.length - accepted`.
- `reasons.malformed` - missing `path` or `userAgent`.
- `reasons.unrecognized` - well-formed, but not AI traffic: no registry match
  and no markdown negotiation. Normal, and usually the largest number.

`accepted + skipped` always equals `hits.length`.

## Errors

Errors carry `{ "error": string, "code": string }`. This is what the WordPress
plugin, the most complete client, does with each status:

| Status | Code                      | Client behaviour                                                        |
| ------ | ------------------------- | ----------------------------------------------------------------------- |
| 401    | `UNAUTHORIZED`            | Stop for good and forget the key. A rejected key never becomes valid on its own. |
| 403    | `BEACON_HOST_NOT_ALLOWED` | Surface the error, keep sending. A fixable misconfiguration, usually www vs apex. |
| 403    | anything else             | Pause 1 hour, keep recording locally.                                   |
| 400    | `BAD_REQUEST`             | Drop the batch as poison. Never retried.                                |
| 413    | `PAYLOAD_TOO_LARGE`       | Drop the batch as poison. Never retried.                                |
| 429    | `RATE_LIMITED`            | Honour `Retry-After`, or 60 seconds.                                    |
| 5xx    | `INTERNAL_ERROR`          | Exponential backoff, `60 * 2^min(failures, 6)` seconds, capped at 1 hour. |

Two consequences a self-hosted server has to respect:

**Never return a bare 403.** A client reads any 403 that is not
`BEACON_HOST_NOT_ALLOWED` as "the account is not entitled" and pauses for an
hour. The reference server uses 403 for nothing else.

**Always send a status for an oversized body**, rather than closing the
connection. A client that sees a socket error backs off and retries a payload it
can never deliver.

`PLAN_INACTIVE` is reserved for hosted SnowSEO, and is what its lapsed-plan 403
carries. The reference server never emits it.

The standalone PHP client (`auto_prepend_file`, no WordPress) implements a
simpler policy: it spools undelivered hits to disk, and opens a 5-minute circuit
breaker on a network failure, a 429 or a 5xx. Other 4xx responses are treated as
a bad payload, matching the table.

## Health

`GET /health` returns `200 {"status":"ok"}`. No authentication.

---

## Semantics

### Addresses

The address is the one part of a request a crawler cannot dress up, so it is
what verification rests on. It is also personal data.

Servers verify against the raw address, then decide what to persist. The
reference server offers three modes: `hash` (HMAC-SHA256, the default and what
SnowSEO does), `raw`, and `discard`. Deferred reverse-DNS holds the raw address
in memory only for as long as the lookup takes.

Clients SHOULD send the address. Without it every hit is `unverified`, and
markdown clients cannot be attributed to a provider at all.

### Clocks

`occurredAt` lets a client buffer and send later. Servers MUST ignore a
timestamp more than 24 hours from their own clock and substitute the receive
time - a skewed client clock would otherwise land hits in the wrong day bucket
permanently.

### Verification states

Every recorded hit gets one of four states:

| State               | Meaning                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `signed`            | A valid RFC 9421 signature. Proves key possession. Strongest.      |
| `verified`          | The address is in the claimed provider's published range, or reverse DNS forward-confirmed it. |
| `unverified`        | Nothing to check against. Not suspicion.                            |
| `spoofed_suspected` | Something checkable contradicts the claim.                          |

`unverified` and `spoofed_suspected` must stay distinct. Collapsing them turns
"we could not tell" into an accusation.

Precedence: a valid signature outranks the address verdict. A signature that
*fails* falls through to the address verdict rather than condemning the hit -
the signature base is rebuilt from a forwarded payload, so a reconstruction gap
must never be recorded as somebody else's forgery.

### Batching

At most 500 hits per request. Clients buffer and flush on their own schedule;
nothing in the protocol requires a hit to be sent while the request is alive.

Hits are not idempotent. A client that retries after a timeout may double-count.
Buffer sizes are small and the data is analytical, so this is accepted rather
than solved with an idempotency key.
