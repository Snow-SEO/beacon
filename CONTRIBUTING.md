# Contributing

Issues and pull requests both land here. The npm packages are published from
this repository's tags, so a merged PR reaches users on the next release.

Anything that changes behaviour needs a test.

## Adding a crawler to the registry

Easily the most common contribution. Entries live in
[`packages/beacon/src/crawlers.ts`](packages/beacon/src/crawlers.ts) and need:

- The User-Agent token to match on, lowercase. The distinguishing substring, not
  the whole string.
- The provider name, spelled as it is for that provider's other agents.
- The category, one of four. `answer_fetch` is a person's assistant reading the
  page to answer them right now; `search_index` builds an index behind an AI
  search product; `training` collects corpus; `ai_crawler` is everything else a
  model vendor runs. Getting this wrong misattributes intent, which is most of
  what the dashboard is for.
- **A link to the provider's own documentation of the agent.** This is the part
  that matters, and the one we will not skip. A log line is not enough on its
  own: a wrong entry silently mislabels real traffic, which is worse than not
  matching it at all.

If the provider also publishes an IP range feed or an authenticating reverse-DNS
suffix, say so. That is what moves a hit from `unverified` to `verified`, and it
goes in
[`packages/beacon-server/src/crawler-ranges.ts`](packages/beacon-server/src/crawler-ranges.ts)
or `ip-verify.ts`.

Where a feed is maintained too loosely to argue from, list it in
`LOW_CONFIDENCE_RANGES` instead - a miss there has to mean "unknown", not
"forged".

## Running the tests

Needs Node 24, or Node 22.5+ with `--experimental-sqlite` - the SQLite store
uses Node's built-in driver rather than a native module.

```bash
pnpm install
pnpm build
pnpm type-check
pnpm test                           # both packages
```

`packages/beacon-server` tests reach the network only where a test says so; the
range caches are seeded directly, which also stops the background warm from
firing.

## Changing the wire protocol

Don't, casually. [`PROTOCOL.md`](packages/beacon-server/PROTOCOL.md) is
implemented by four clients, and installs in the wild are upgraded slowly or
never. Fields are added, never removed or repurposed.

A change that makes an old client behave differently against a new server, or
the reverse, is breaking however small it looks. The status-code contract is
part of that: clients pause, drop or stop for good depending on what comes back,
and a server returning the wrong one silences a site for an hour.

## Style

Comments explain intent and constraints, not mechanics. If the code already says
what it does, the comment should say why it has to. No em-dashes.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).
