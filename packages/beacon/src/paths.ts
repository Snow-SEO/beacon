const TRAILING_SLASHES = /\/+$/;

const MD_SUFFIX = ".md";

function normalizePath(pathname: string): string {
	const clean = pathname.replace(TRAILING_SLASHES, "");
	return clean.length === 0 ? "/" : clean;
}

export function isMarkdownPath(pathname: string): boolean {
	return pathname.toLowerCase().endsWith(MD_SUFFIX);
}

export function toMarkdownPath(pathname: string): string {
	if (isMarkdownPath(pathname)) {
		return pathname;
	}
	const clean = normalizePath(pathname);
	return clean === "/" ? "/index.md" : `${clean}${MD_SUFFIX}`;
}

export function fromMarkdownPath(pathname: string): string {
	if (!isMarkdownPath(pathname)) {
		return pathname;
	}
	const withoutSuffix = pathname.slice(0, -MD_SUFFIX.length);
	return withoutSuffix === "/index" || withoutSuffix === ""
		? "/"
		: withoutSuffix;
}

export function toMarkdownUrl(input: string | URL, siteUrl?: string): string {
	const url =
		typeof input === "string" ? new URL(input, siteUrl) : new URL(input);
	url.pathname = toMarkdownPath(url.pathname);
	return url.toString();
}

export function toCanonicalUrl(input: string | URL, siteUrl?: string): string {
	const url =
		typeof input === "string" ? new URL(input, siteUrl) : new URL(input);
	url.pathname = fromMarkdownPath(url.pathname);
	return url.toString();
}
