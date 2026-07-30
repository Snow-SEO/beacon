# Security policy

## Reporting a vulnerability

Please do not open a public issue.

Use GitHub's [private vulnerability
reporting](https://github.com/Snow-SEO/beacon/security/advisories/new), or email
**security@snowseo.com**.

Include what you need to demonstrate it: affected package and version, the
conditions required, and a proof of concept if you have one. We will confirm
receipt within three working days and keep you updated while we work on it. If
you would like credit in the advisory, say so and we will name you.

## Supported versions

The latest release of each package. Beacon is pre-1.0; fixes go onto `main` and
into the next release rather than being backported.

## Scope

The parts of this repository most worth looking at, and the assumptions they
make:

**`@snowseo/beacon` (client)** runs inside your web server on every request it
handles. It reads request headers and serves files from a directory you point it
at. Path traversal out of that directory, or anything in the HTML-to-Markdown
converter that could be driven by page content, is in scope.

**`@snowseo/beacon-server`** processes untrusted input by design: every field of
every hit is attacker-influenced, because anyone can send your site a request
with any User-Agent and any header. Specific areas:

- `web-bot-auth.ts` resolves a key directory from a URL supplied in a request
  header. Outbound requests go through an SSRF guard (`safe-fetch.ts`,
  `url-validation.ts`) for exactly this reason. A bypass of that guard is a
  serious finding.
- `cidr-match.ts` parses attacker-supplied address strings. It is written not to
  throw, because a crash there takes down ingest.
- Signature verification must never conclude "forgery" from its own failure to
  reconstruct a request. A path that turns a verifier bug into a
  `spoofed_suspected` verdict against an innocent crawler is a real finding.

**The reference ingest server** ships with no rate limiting and no TLS, and is
documented as needing a reverse proxy in front of it. Reports that it can be
flooded when exposed directly are not a vulnerability. Authentication bypass -
reaching ingest without a valid key, or reporting for a host outside a scoped
key's allow-list - is.

**Out of scope:** the hosted SnowSEO platform (report those to the same address,
but they are not this repository), findings that require an attacker who already
has your beacon key, and the deliberate non-idempotency of ingest documented in
`PROTOCOL.md`.
