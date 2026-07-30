export const MAX_URLS_PER_SITEMAP = 50000;

export interface SitemapEntry {
	url: string;
	lastmod?: string;
	changefreq?:
		| "always"
		| "hourly"
		| "daily"
		| "weekly"
		| "monthly"
		| "yearly"
		| "never";
	priority?: number;
}

const XML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&apos;",
};

const XML_UNSAFE = /[&<>"']/g;

export function escapeXml(value: string): string {
	return value.replace(XML_UNSAFE, (char) => XML_ESCAPES[char] ?? char);
}

function renderEntry(entry: SitemapEntry): string {
	const parts = [`    <loc>${escapeXml(entry.url)}</loc>`];
	if (entry.lastmod) {
		parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
	}
	if (entry.changefreq) {
		parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
	}
	if (typeof entry.priority === "number") {
		const clamped = Math.min(1, Math.max(0, entry.priority));
		parts.push(`    <priority>${clamped.toFixed(1)}</priority>`);
	}
	return `  <url>\n${parts.join("\n")}\n  </url>`;
}

function toEntry(input: string | SitemapEntry): SitemapEntry {
	return typeof input === "string" ? { url: input } : input;
}

export function buildMdSitemap(
	entries: readonly (string | SitemapEntry)[],
): string {
	const normalized = entries.map(toEntry);
	if (normalized.length > MAX_URLS_PER_SITEMAP) {
		throw new RangeError(
			`A sitemap holds at most ${MAX_URLS_PER_SITEMAP} URLs; got ${normalized.length}. Use chunkSitemapEntries() and buildSitemapIndex().`,
		);
	}
	const body = normalized.map(renderEntry).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>`;
}

export interface SitemapIndexEntry {
	url: string;
	lastmod?: string;
}

export function buildSitemapIndex(
	sitemaps: readonly (string | SitemapIndexEntry)[],
): string {
	const body = sitemaps
		.map((input) => (typeof input === "string" ? { url: input } : input))
		.map((entry) => {
			const parts = [`    <loc>${escapeXml(entry.url)}</loc>`];
			if (entry.lastmod) {
				parts.push(`    <lastmod>${escapeXml(entry.lastmod)}</lastmod>`);
			}
			return `  <sitemap>\n${parts.join("\n")}\n  </sitemap>`;
		})
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</sitemapindex>`;
}

export function chunkSitemapEntries<T>(
	entries: readonly T[],
	size: number = MAX_URLS_PER_SITEMAP,
): T[][] {
	if (size < 1) {
		throw new RangeError("Chunk size must be at least 1");
	}
	const chunks: T[][] = [];
	for (let i = 0; i < entries.length; i += size) {
		chunks.push(entries.slice(i, i + size));
	}
	return chunks;
}

export function robotsSitemapDirective(sitemapUrl: string): string {
	return `Sitemap: ${sitemapUrl}`;
}
