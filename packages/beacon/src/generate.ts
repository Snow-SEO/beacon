import { extractMetadata, htmlToMarkdown } from "./convert.js";
import { type LlmsTxtSection, renderLlmsTxt } from "./llms-txt.js";
import { toMarkdownPath } from "./paths.js";
import { buildMdSitemap, type SitemapEntry } from "./sitemap.js";
import { estimateTokens } from "./tokens.js";

const TRAILING_SLASHES = /\/+$/;

const DEFAULT_MIN_CONTENT_CHARS = 24;

const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;

const MD_SYNTAX = /[#>*_`~\-|]/g;

const WHITESPACE = /\s+/g;

function proseLength(markdown: string): number {
	return markdown
		.replace(MD_IMAGE, "")
		.replace(MD_LINK, "$1")
		.replace(MD_SYNTAX, "")
		.replace(WHITESPACE, "").length;
}

export interface GenerateOptions {
	dir: string;
	siteUrl: string;
	exclude?: readonly string[];
	extractMain?: boolean;
	minContentChars?: number;
	llmsTxt?:
		| boolean
		| {
				name?: string;
				summary?: string;
		  };
	sitemap?: boolean;
	dryRun?: boolean;
}

export interface GeneratedTwin {
	route: string;
	htmlFile: string;
	mdFile: string;
	title: string | null;
	description: string | null;
	markdown: string;
	tokens: number;
	unchanged: boolean;
}

export type SkipReason = "excluded" | "empty" | "duplicate";

export interface SkippedPage {
	route: string;
	htmlFile: string;
	reason: SkipReason;
	chars: number;
}

export interface GenerateResult {
	twins: GeneratedTwin[];
	skipped: SkippedPage[];
	llmsTxtFile: string | null;
	sitemapFile: string | null;
	allEmpty: boolean;
}

interface NodeFs {
	readdir: (
		dir: string,
		options: {
			withFileTypes: true;
		},
	) => Promise<
		{
			name: string;
			isDirectory: () => boolean;
			isFile: () => boolean;
		}[]
	>;
	readFile: (file: string, encoding: "utf8") => Promise<string>;
	writeFile: (file: string, data: string, encoding: "utf8") => Promise<void>;
	mkdir: (
		dir: string,
		options: {
			recursive: true;
		},
	) => Promise<unknown>;
}

interface NodePath {
	join: (...parts: string[]) => string;
	resolve: (...parts: string[]) => string;
	dirname: (file: string) => string;
	relative: (from: string, to: string) => string;
	sep: string;
}

async function loadNode(): Promise<{
	fs: NodeFs;
	path: NodePath;
}> {
	const [fs, path] = await Promise.all([
		import("node:fs/promises"),
		import("node:path"),
	]);
	return { fs: fs as unknown as NodeFs, path: path as unknown as NodePath };
}

const IGNORED_DIRS = new Set([
	"assets",
	"_astro",
	"_next",
	"_app",
	"node_modules",
	".git",
	".vercel",
	".netlify",
]);

const PATH_SEPARATOR = /[\\/]/;

const HTML_EXTENSION = /\.html?$/i;

const INDEX_SEGMENT = /(^|\/)index$/i;

const REPEATED_SLASHES = /\/{2,}/g;

const INDEX_FILE = /(^|[\\/])index\.html?$/i;

const LEADING_SLASHES = /^\/+/;

export function routeForHtmlFile(relativeFile: string): string {
	const posix = relativeFile.split(PATH_SEPARATOR).join("/");
	const withoutExt = posix.replace(HTML_EXTENSION, "");
	const route = withoutExt.replace(INDEX_SEGMENT, "$1");
	const cleaned = `/${route}`
		.replace(REPEATED_SLASHES, "/")
		.replace(TRAILING_SLASHES, "");
	return cleaned === "" ? "/" : cleaned;
}

async function walkHtml(
	fs: NodeFs,
	path: NodePath,
	root: string,
	current: string,
	out: string[],
): Promise<void> {
	const entries = await fs.readdir(current, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(current, entry.name);
		if (entry.isDirectory()) {
			if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith(".")) {
				continue;
			}
			await walkHtml(fs, path, root, full, out);
		} else if (entry.isFile() && HTML_EXTENSION.test(entry.name)) {
			out.push(path.relative(root, full));
		}
	}
}

function isExcluded(route: string, exclude: readonly string[]): boolean {
	return exclude.some(
		(prefix) => route === prefix || route.startsWith(`${prefix}/`),
	);
}

function preferIndexForm(a: string, b: string): string {
	const aIsIndex = INDEX_FILE.test(a);
	const bIsIndex = INDEX_FILE.test(b);
	if (aIsIndex === bIsIndex) {
		return a;
	}
	return aIsIndex ? a : b;
}

export async function generateTwins(
	options: GenerateOptions,
): Promise<GenerateResult> {
	const { fs, path } = await loadNode();
	const root = path.resolve(options.dir);
	const siteUrl = options.siteUrl.replace(TRAILING_SLASHES, "");
	const exclude = options.exclude ?? [];
	const minChars = options.minContentChars ?? DEFAULT_MIN_CONTENT_CHARS;
	const htmlFiles: string[] = [];
	await walkHtml(fs, path, root, root, htmlFiles);
	const skipped: SkippedPage[] = [];
	const byRoute = new Map<string, string>();
	for (const file of htmlFiles.sort()) {
		const route = routeForHtmlFile(file);
		const existing = byRoute.get(route);
		if (!existing) {
			byRoute.set(route, file);
			continue;
		}
		const winner = preferIndexForm(existing, file);
		const loser = winner === existing ? file : existing;
		byRoute.set(route, winner);
		skipped.push({ route, htmlFile: loser, reason: "duplicate", chars: 0 });
	}
	const twins: GeneratedTwin[] = [];
	let discovered = 0;
	for (const [route, htmlFile] of [...byRoute].sort()) {
		if (isExcluded(route, exclude)) {
			skipped.push({ route, htmlFile, reason: "excluded", chars: 0 });
			continue;
		}
		discovered += 1;
		const html = await fs.readFile(path.join(root, htmlFile), "utf8");
		const canonical = `${siteUrl}${route}`;
		const markdown = htmlToMarkdown(html, {
			baseUrl: canonical,
			extractMain: options.extractMain,
		}).trim();
		const prose = proseLength(markdown);
		if (prose < minChars) {
			skipped.push({ route, htmlFile, reason: "empty", chars: prose });
			continue;
		}
		const { title, description } = extractMetadata(html);
		const mdFile = toMarkdownPath(route).replace(LEADING_SLASHES, "");
		const target = path.join(root, mdFile);
		let unchanged = false;
		try {
			unchanged = (await fs.readFile(target, "utf8")) === markdown;
		} catch {
			unchanged = false;
		}
		if (!(options.dryRun || unchanged)) {
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.writeFile(target, markdown, "utf8");
		}
		twins.push({
			route,
			htmlFile,
			mdFile,
			title,
			description,
			markdown,
			tokens: estimateTokens(markdown),
			unchanged,
		});
	}
	const emptyCount = skipped.filter((s) => s.reason === "empty").length;
	const allEmpty = discovered > 0 && emptyCount === discovered;
	let llmsTxtFile: string | null = null;
	let sitemapFile: string | null = null;
	if (twins.length > 0) {
		if (options.llmsTxt !== false) {
			const meta = typeof options.llmsTxt === "object" ? options.llmsTxt : {};
			const contents = renderLlmsTxt({
				name: meta.name ?? new URL(siteUrl).hostname,
				...(meta.summary ? { summary: meta.summary } : {}),
				sections: buildSections(twins, siteUrl),
			});
			llmsTxtFile = "llms.txt";
			if (!options.dryRun) {
				await fs.writeFile(path.join(root, llmsTxtFile), contents, "utf8");
			}
		}
		if (options.sitemap !== false) {
			const entries: SitemapEntry[] = twins.map((twin) => ({
				url: `${siteUrl}${toMarkdownPath(twin.route)}`,
			}));
			sitemapFile = "sitemap-md.xml";
			if (!options.dryRun) {
				await fs.writeFile(
					path.join(root, sitemapFile),
					buildMdSitemap(entries),
					"utf8",
				);
			}
		}
	}
	return { twins, skipped, llmsTxtFile, sitemapFile, allEmpty };
}

function buildSections(
	twins: readonly GeneratedTwin[],
	siteUrl: string,
): LlmsTxtSection[] {
	const toLink = (twin: GeneratedTwin) => ({
		title: twin.title ?? twin.route,
		url: `${siteUrl}${toMarkdownPath(twin.route)}`,
		...(twin.description ? { description: twin.description } : {}),
	});
	const bySegment = new Map<string, GeneratedTwin[]>();
	for (const twin of twins) {
		const segment = twin.route === "/" ? "" : (twin.route.split("/")[1] ?? "");
		const group = bySegment.get(segment);
		if (group) {
			group.push(twin);
		} else {
			bySegment.set(segment, [twin]);
		}
	}
	const sections: LlmsTxtSection[] = [];
	const loose: GeneratedTwin[] = [];
	for (const [segment, group] of bySegment) {
		if (segment && group.length > 1) {
			sections.push({
				title:
					segment.charAt(0).toUpperCase() +
					segment.slice(1).replace(/[-_]/g, " "),
				links: group.map(toLink),
			});
		} else {
			loose.push(...group);
		}
	}
	if (loose.length > 0) {
		sections.unshift({ title: "Pages", links: loose.map(toLink) });
	}
	return sections;
}
