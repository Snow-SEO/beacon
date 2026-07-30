# Examples

Runnable TypeScript projects, one per integration shape. Each installs against
the packages in this repo, so a breaking change fails here before it reaches a
release.

| Example | Shows |
| --- | --- |
| [`self-hosted`](./self-hosted) | Express site plus **your own collector**. No SnowSEO account. Read this one first if you care about the open half. |
| [`nextjs`](./nextjs) | App Router. Twins from a content source via `resolve`, `llms.txt` from the same source. |
| [`astro`](./astro) | Prebuilt twins from `beacon build`, and the one framework the middleware exports into directly. |

## Two ways to get twins

Which one you want is the main decision, and the examples split along it.

**From a directory** (`dir`, used by `astro` and `self-hosted`) - `beacon build`
converts built HTML into `.md` files next to it. Right when you have a build
output, and it works on a static host with no runtime.

**From a resolver** (`resolve`, used by `nextjs`) - you hand back Markdown for a
path. Right when content lives in a CMS or database and there is no HTML on disk
to convert.

## A note on versions

Examples declare `"@snowseo/beacon": "^0.1.0"`, not `workspace:*`, so copying
one out of this repo gives you something that installs. Inside the repo pnpm
links them to the local packages instead.
