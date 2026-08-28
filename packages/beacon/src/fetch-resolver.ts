import type { MarkdownResolver } from "./beacon.js";
import { extractMetadata, htmlToMarkdown } from "./convert.js";

export const TWIN_FETCH_HEADER = "x-beacon-twin";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_TIMEOUT_MS = 5000;

export interface FetchResolverOptions {
	siteUrl: string;
	extractMain?: boolean;
	ttlMs?: number;
	maxEntries?: number;
	timeoutMs?: number;
	fetch?: typeof fetch;
	frontmatter?: boolean;
}

function buildFrontmatter(fields: Record<string, string | null>): string {
	const lines = Object.entries(fields)
		.filter(([, value]) => value?.trim())
		.map(([key, value]) => `${key}: ${JSON.stringify(value?.trim())}`);
	return lines.length > 0 ? `---\n${lines.join("\n")}\n---\n\n` : "";
}

interface Entry {
	markdown: string | null;
	expiresAt: number;
}

/**
 * Converts the rendered page for sites with no markdown source.
 *
 * The fetch re-enters your own server, so every request carries
 * {@link TWIN_FETCH_HEADER}: skip beacon in your middleware when
 * {@link isTwinFetch} is true, or it recurses.
 */
export function createFetchResolver(
	options: FetchResolverOptions,
): MarkdownResolver {
	const {
		siteUrl,
		extractMain = true,
		ttlMs = DEFAULT_TTL_MS,
		maxEntries = DEFAULT_MAX_ENTRIES,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		fetch: fetchImpl = globalThis.fetch,
		frontmatter: withFrontmatter = true,
	} = options;

	const cache = new Map<string, Entry>();

	const remember = (path: string, markdown: string | null): string | null => {
		if (cache.size >= maxEntries) {
			const oldest = cache.keys().next();
			if (!oldest.done) {
				cache.delete(oldest.value);
			}
		}
		cache.set(path, { markdown, expiresAt: Date.now() + ttlMs });
		return markdown;
	};

	return async (path) => {
		const cached = cache.get(path);
		if (cached && cached.expiresAt > Date.now()) {
			return cached.markdown;
		}
		if (cached) {
			cache.delete(path);
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetchImpl(new URL(path, siteUrl), {
				headers: { [TWIN_FETCH_HEADER]: "1", accept: "text/html" },
				signal: controller.signal,
			});
			if (!response.ok) {
				return remember(path, null);
			}
			// A catch-all route answering HTML for everything would otherwise mint
			// a twin for every URL a crawler invents.
			const type = response.headers.get("content-type") ?? "";
			if (!type.includes("html")) {
				return remember(path, null);
			}
			const html = await response.text();
			const body = htmlToMarkdown(html, { extractMain, baseUrl: siteUrl });
			// Emptiness is judged on the body alone. Frontmatter is never empty,
			// so counting it would mint a twin for a page with no content at all.
			if (!body.trim()) {
				return remember(path, null);
			}
			if (!withFrontmatter) {
				return remember(path, body);
			}
			const meta = extractMetadata(html);
			const head = buildFrontmatter({
				title: meta.title,
				description: meta.description,
				url: new URL(path, siteUrl).toString(),
			});
			return remember(path, `${head}${body}`);
		} catch {
			// Uncached: a blip must not suppress the twin for a whole TTL.
			return null;
		} finally {
			clearTimeout(timer);
		}
	};
}

export function isTwinFetch(request: Request): boolean {
	return request.headers.get(TWIN_FETCH_HEADER) === "1";
}
