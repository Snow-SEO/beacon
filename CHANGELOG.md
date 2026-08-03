# Changelog

Both packages are released together and share a version.

## 0.1.2

### Changed

- **The ingest route is now `/beacon/hits`**, dropping a version prefix it had
  inherited from the SnowSEO API it was extracted from.

  Client and server move together - both packages share a version. An `endpoint`
  set to a bare origin needs no edit, since the path is filled in by
  [`normalizeIngestEndpoint`](./packages/beacon/src/analytics.ts); only one
  written out in full does. A server can keep serving the old route with
  `ingestPath`.

  Reporting to hosted SnowSEO is unaffected: `DEFAULT_INGEST_ENDPOINT` is a
  literal now rather than derived from `INGEST_PATH`, so the two can differ.
  Setting `endpoint` to a bare origin no longer reaches hosted SnowSEO - omit
  `endpoint` entirely instead.

### Fixed

- **A rollup test failed permanently after 2026-07-31.** It pinned `occurredAt`
  to a literal `2026-07-30T10:00:00.000Z` and asserted the rollup landed in that
  day's bucket, so once real time drifted more than 24 hours past it the
  clock-skew rule in `parseOccurredAt` did exactly what the protocol requires -
  substituted the receive time - and the assertion broke. The timestamp is now
  derived from the current clock.
  ([`ingest.test.ts`](./packages/beacon-server/test/ingest.test.ts))

## 0.1.1

Two bugs, both found by writing the [examples](./examples) rather than by the
test suite - the existing tests passed throughout, because they exercised the
adapters with plain objects rather than what a real framework hands you.

### Fixed

- **`createFetchMiddleware` broke `astro build`.** The middleware spread its
  context to pass it along, and spreading Astro's `APIContext` invokes every
  getter on it - including `clientAddress`, which throws on a prerendered
  route. A static Astro build failed outright. It only ever needed `waitUntil`,
  so it now takes that and nothing else. ([`fetch.ts`](./packages/beacon/src/adapters/fetch.ts))

- **`beaconExpress` did not type-check against `@types/express`.**
  `NodeRequestLike` declared `socket?: { encrypted?: boolean }`, which nothing
  read. An interface whose only members are optional is a "weak type", and
  TypeScript rejects a value with no properties in common - Node's `net.Socket`
  has no `encrypted`, so a real `express.Request` was refused and
  `app.use(beaconExpress(beacon))` failed to compile. The dead field is gone.
  ([`node.ts`](./packages/beacon/src/adapters/node.ts))

- **`@snowseo/beacon-server` pinned an exact client version.** Its dependency
  was `workspace:*`, which pnpm publishes as `"0.1.0"` rather than a range, so a
  patch to `@snowseo/beacon` could never reach anyone who installed the server.
  Now `workspace:^`, published as a caret range.

### Added

- Three runnable TypeScript examples: a self-hosted collector, Next.js, and
  Astro. They resolve the local packages in-repo and run in CI, so a breaking
  change fails before a release rather than after one.

- Regression tests covering the fetch adapter against a getter-backed context,
  which is what actually reproduces the Astro failure.

### Upgrading

No API changed. `NodeRequestLike` lost an optional member, so the only way to
notice is if you assigned an object literal that set `socket` - remove it.

## 0.1.0

Initial release.

- `@snowseo/beacon` - Markdown twin generation and serving, content negotiation,
  crawler reporting. Adapters for Next.js, Express and any Fetch-API runtime,
  plus the `beacon build` CLI.
- `@snowseo/beacon-server` - crawler verification from published IP ranges,
  datacenter detection, reverse DNS and Web Bot Auth, plus a reference ingest
  server with SQLite and Postgres stores.
