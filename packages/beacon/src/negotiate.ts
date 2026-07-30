export type Representation = "html" | "markdown";

export interface ParsedMediaType {
	type: string;
	subtype: string;
	quality: number;
}

const DEFAULT_QUALITY = 1;

export function parseAcceptHeader(header: string | null): ParsedMediaType[] {
	if (!header) {
		return [];
	}
	const parsed: ParsedMediaType[] = [];
	for (const part of header.split(",")) {
		const [rawType, ...params] = part.split(";");
		const trimmed = rawType?.trim().toLowerCase();
		if (!trimmed) {
			continue;
		}
		const [type, subtype] = trimmed.split("/");
		if (!(type && subtype)) {
			continue;
		}
		let quality = DEFAULT_QUALITY;
		for (const param of params) {
			const [key, value] = param.split("=").map((s) => s.trim().toLowerCase());
			if (key === "q") {
				const q = Number.parseFloat(value ?? "");
				if (!Number.isNaN(q)) {
					quality = q;
				}
			}
		}
		parsed.push({ type, subtype, quality });
	}
	return parsed
		.map((media, index) => ({ media, index }))
		.sort((a, b) => b.media.quality - a.media.quality || a.index - b.index)
		.map(({ media }) => media);
}

function isExactly(
	media: ParsedMediaType,
	type: string,
	subtype: string,
): boolean {
	return media.type === type && media.subtype === subtype;
}

function isWildcard(media: ParsedMediaType): boolean {
	return media.subtype === "*" && (media.type === "*" || media.type === "text");
}

function exactRepresentation(media: ParsedMediaType): Representation | null {
	if (isExactly(media, "text", "markdown")) {
		return "markdown";
	}
	if (isExactly(media, "text", "html")) {
		return "html";
	}
	return null;
}

export function negotiateFormat(
	accept: string | null,
	available: readonly Representation[] = ["html", "markdown"],
): Representation | null {
	const parsed = parseAcceptHeader(accept);
	const fallback = available.includes("html") ? "html" : (available[0] ?? null);
	if (parsed.length === 0) {
		return fallback;
	}
	const explicitlyRefused = new Set<Representation>();
	const explicitlyAccepted = new Set<Representation>();
	let wildcardRefusesAll = false;
	for (const media of parsed) {
		const refused = media.quality === 0;
		if (isWildcard(media)) {
			if (refused) {
				wildcardRefusesAll = true;
			}
			continue;
		}
		const rep = exactRepresentation(media);
		if (rep) {
			(refused ? explicitlyRefused : explicitlyAccepted).add(rep);
		}
	}
	const canServe = (rep: Representation): boolean =>
		available.includes(rep) &&
		!explicitlyRefused.has(rep) &&
		(!wildcardRefusesAll || explicitlyAccepted.has(rep));
	for (const media of parsed) {
		if (media.quality === 0) {
			continue;
		}
		if (isExactly(media, "text", "markdown") && canServe("markdown")) {
			return "markdown";
		}
		if (isExactly(media, "text", "html") && canServe("html")) {
			return "html";
		}
		if (isWildcard(media)) {
			if (canServe("html")) {
				return "html";
			}
			if (canServe("markdown")) {
				return "markdown";
			}
		}
	}
	return null;
}
