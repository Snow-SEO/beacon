export interface ConvertOptions {
	extractMain?: boolean;
	baseUrl?: string;
}

const VOID_CONTENT_TAGS = new Set([
	"script",
	"style",
	"noscript",
	"svg",
	"canvas",
	"template",
	"head",
	"iframe",
	"object",
	"form",
]);

const VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"div",
	"dl",
	"dd",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tbody",
	"td",
	"tfoot",
	"th",
	"thead",
	"tr",
	"ul",
]);

const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	mdash: "-",
	ndash: "-",
	hellip: "...",
	rsquo: "'",
	lsquo: "'",
	rdquo: '"',
	ldquo: '"',
	copy: "(c)",
	reg: "(r)",
	trade: "(tm)",
	deg: "degrees",
	middot: "*",
	bull: "*",
};

const ENTITY_RE = /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeEntities(text: string): string {
	return text.replace(ENTITY_RE, (match, entity: string) => {
		if (entity.startsWith("#")) {
			const isHex = entity[1] === "x" || entity[1] === "X";
			const code = Number.parseInt(
				isHex ? entity.slice(2) : entity.slice(1),
				isHex ? 16 : 10,
			);
			return Number.isFinite(code) && code > 0
				? String.fromCodePoint(code)
				: match;
		}
		return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
	});
}

function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]])/g, "\\$1");
}

interface Token {
	kind: "text" | "open" | "close";
	tag: string;
	attrs: Record<string, string>;
	text: string;
	selfClosing: boolean;
}

const TAG_RE =
	/<(\/)?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?>/g;

const ATTR_RE =
	/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

const COMMENT_RE = /<!--[\s\S]*?-->/g;

const DOCTYPE_RE = /<![^>]*>/g;

const ARTICLE_OPEN_RE = /<article[^>]*>/i;

const MAIN_OPEN_RE = /<main[^>]*>/i;

const ROLE_MAIN_RE = /<([a-zA-Z][a-zA-Z0-9-]*)[^>]*role=["']main["'][^>]*>/i;

const BODY_OPEN_RE = /<body[^>]*>/i;

const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const META_DESC_NAME_FIRST_RE =
	/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i;

const META_DESC_CONTENT_FIRST_RE =
	/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i;

const EMPTY_INLINE_RE =
	/<(i|b|em|strong|span|u|s|mark|small|sub|sup)\b[^>]*>\s*<\/\1>/gi;

function stripEmptyInline(html: string): string {
	let out = html;
	for (let previous = ""; previous !== out; ) {
		previous = out;
		out = out.replace(EMPTY_INLINE_RE, "");
	}
	return out;
}

function parseAttrs(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	let match = ATTR_RE.exec(raw);
	while (match !== null) {
		const name = match[1]?.toLowerCase();
		if (name) {
			attrs[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
		}
		match = ATTR_RE.exec(raw);
	}
	ATTR_RE.lastIndex = 0;
	return attrs;
}

function tokenize(html: string): Token[] {
	const tokens: Token[] = [];
	let lastIndex = 0;
	let match = TAG_RE.exec(html);
	const pushText = (text: string) => {
		if (text) {
			tokens.push({
				kind: "text",
				tag: "",
				attrs: {},
				text,
				selfClosing: false,
			});
		}
	};
	while (match !== null) {
		pushText(html.slice(lastIndex, match.index));
		const tag = (match[2] ?? "").toLowerCase();
		tokens.push({
			kind: match[1] ? "close" : "open",
			tag,
			attrs: match[1] ? {} : parseAttrs(match[3] ?? ""),
			text: "",
			selfClosing: Boolean(match[4]) || VOID_TAGS.has(tag),
		});
		lastIndex = match.index + match[0].length;
		match = TAG_RE.exec(html);
	}
	pushText(html.slice(lastIndex));
	TAG_RE.lastIndex = 0;
	return tokens;
}

const CONTAINERS: readonly {
	tag: string;
	re: RegExp;
}[] = [
	{ tag: "article", re: ARTICLE_OPEN_RE },
	{ tag: "main", re: MAIN_OPEN_RE },
];

function extractContainer(html: string): string {
	for (const { tag, re } of CONTAINERS) {
		const open = re.exec(html);
		if (open) {
			const start = open.index + open[0].length;
			const close = html.toLowerCase().lastIndexOf(`</${tag}>`);
			if (close > start) {
				return html.slice(start, close);
			}
		}
	}
	const roleMain = ROLE_MAIN_RE.exec(html);
	if (roleMain?.[1]) {
		const start = roleMain.index + roleMain[0].length;
		const close = html
			.toLowerCase()
			.lastIndexOf(`</${roleMain[1].toLowerCase()}>`);
		if (close > start) {
			return html.slice(start, close);
		}
	}
	const body = BODY_OPEN_RE.exec(html);
	if (body) {
		const start = body.index + body[0].length;
		const close = html.toLowerCase().lastIndexOf("</body>");
		return close > start ? html.slice(start, close) : html.slice(start);
	}
	return html;
}

function resolveUrl(url: string, baseUrl?: string): string {
	if (!(url && baseUrl)) {
		return url;
	}
	try {
		return new URL(url, baseUrl).toString();
	} catch {
		return url;
	}
}

interface ListFrame {
	ordered: boolean;
	index: number;
}

export function htmlToMarkdown(
	html: string,
	options: ConvertOptions = {},
): string {
	let source = stripEmptyInline(
		html.replace(COMMENT_RE, "").replace(DOCTYPE_RE, ""),
	);
	if (options.extractMain !== false) {
		source = extractContainer(source);
	}
	const tokens = tokenize(source);
	const out: string[] = [];
	const lists: ListFrame[] = [];
	let skipDepth = 0;
	let skipTag = "";
	let preDepth = 0;
	let quoteDepth = 0;
	let line = "";
	let pendingHref: string | null = null;
	let linkText = "";
	const tableRow: string[] = [];
	let tableCell: string | null = null;
	let tableRowCount = 0;
	const flushLine = () => {
		const trimmed = line.replace(/[ \t]+$/g, "");
		if (trimmed.trim()) {
			out.push(
				quoteDepth > 0 ? `${"> ".repeat(quoteDepth)}${trimmed}` : trimmed,
			);
		} else if (out.length > 0 && out.at(-1) !== "") {
			out.push("");
		}
		line = "";
	};
	const write = (text: string) => {
		if (tableCell !== null) {
			tableCell += text;
		} else if (pendingHref !== null) {
			linkText += text;
		} else {
			line += text;
		}
	};
	const listPrefix = (): string => {
		const frame = lists.at(-1);
		const indent = "  ".repeat(Math.max(0, lists.length - 1));
		if (!frame) {
			return "";
		}
		return frame.ordered ? `${indent}${frame.index}. ` : `${indent}- `;
	};
	for (const token of tokens) {
		if (skipDepth > 0) {
			if (
				token.kind === "open" &&
				token.tag === skipTag &&
				!token.selfClosing
			) {
				skipDepth += 1;
			} else if (token.kind === "close" && token.tag === skipTag) {
				skipDepth -= 1;
			}
			continue;
		}
		if (token.kind === "text") {
			const decoded = decodeEntities(token.text);
			if (preDepth > 0) {
				write(decoded);
			} else {
				const collapsed = decoded.replace(/\s+/g, " ");
				if (collapsed.trim() || line.endsWith(" ") === false) {
					write(preDepth > 0 ? collapsed : escapeMarkdown(collapsed));
				}
			}
			continue;
		}
		const { tag, attrs } = token;
		if (token.kind === "open" && VOID_CONTENT_TAGS.has(tag)) {
			if (!token.selfClosing) {
				skipDepth = 1;
				skipTag = tag;
			}
			continue;
		}
		if (token.kind === "open") {
			switch (tag) {
				case "br":
					line += "  \n";
					break;
				case "hr":
					flushLine();
					out.push("---", "");
					break;
				case "img": {
					const src = resolveUrl(attrs.src ?? "", options.baseUrl);
					if (src && !src.startsWith("data:")) {
						write(`![${attrs.alt ?? ""}](${src})`);
					}
					break;
				}
				case "h1":
				case "h2":
				case "h3":
				case "h4":
				case "h5":
				case "h6":
					flushLine();
					line = `${"#".repeat(Number(tag[1]))} `;
					break;
				case "p":
				case "div":
				case "section":
				case "figure":
				case "figcaption":
					flushLine();
					break;
				case "strong":
				case "b":
					write("**");
					break;
				case "em":
				case "i":
					write("*");
					break;
				case "del":
				case "s":
					write("~~");
					break;
				case "code":
					if (preDepth === 0) {
						write("`");
					}
					break;
				case "pre":
					flushLine();
					preDepth += 1;
					out.push("```");
					break;
				case "blockquote":
					flushLine();
					quoteDepth += 1;
					break;
				case "ul":
				case "ol":
					flushLine();
					lists.push({ ordered: tag === "ol", index: 1 });
					break;
				case "li":
					flushLine();
					line = listPrefix();
					break;
				case "a":
					pendingHref = attrs.href ?? "";
					linkText = "";
					break;
				case "table":
					flushLine();
					tableRowCount = 0;
					break;
				case "tr":
					tableRow.length = 0;
					break;
				case "th":
				case "td":
					tableCell = "";
					break;
				default:
					break;
			}
			if (token.selfClosing && tag === "a") {
				pendingHref = null;
			}
			continue;
		}
		switch (tag) {
			case "h1":
			case "h2":
			case "h3":
			case "h4":
			case "h5":
			case "h6":
			case "p":
			case "div":
			case "section":
			case "figure":
			case "figcaption":
				flushLine();
				break;
			case "strong":
			case "b":
				write("**");
				break;
			case "em":
			case "i":
				write("*");
				break;
			case "del":
			case "s":
				write("~~");
				break;
			case "code":
				if (preDepth === 0) {
					write("`");
				}
				break;
			case "pre":
				flushLine();
				preDepth = Math.max(0, preDepth - 1);
				out.push("```", "");
				break;
			case "blockquote":
				flushLine();
				quoteDepth = Math.max(0, quoteDepth - 1);
				out.push("");
				break;
			case "ul":
			case "ol":
				flushLine();
				lists.pop();
				out.push("");
				break;
			case "li": {
				flushLine();
				const frame = lists.at(-1);
				if (frame) {
					frame.index += 1;
				}
				break;
			}
			case "a": {
				const href = resolveUrl(pendingHref ?? "", options.baseUrl);
				const text = linkText.trim();
				pendingHref = null;
				const rendered = href && text ? `[${text}](${href})` : text;
				linkText = "";
				write(rendered);
				break;
			}
			case "th":
			case "td":
				tableRow.push((tableCell ?? "").replace(/\s+/g, " ").trim());
				tableCell = null;
				break;
			case "tr":
				if (tableRow.length > 0) {
					out.push(`| ${tableRow.join(" | ")} |`);
					tableRowCount += 1;
					if (tableRowCount === 1) {
						out.push(`| ${tableRow.map(() => "---").join(" | ")} |`);
					}
				}
				tableRow.length = 0;
				break;
			case "table":
				out.push("");
				break;
			default:
				if (BLOCK_TAGS.has(tag)) {
					flushLine();
				}
				break;
		}
	}
	flushLine();
	return out
		.join("\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function extractMetadata(html: string): {
	title: string | null;
	description: string | null;
} {
	const title = TITLE_RE.exec(html)?.[1];
	const description =
		META_DESC_NAME_FIRST_RE.exec(html)?.[1] ??
		META_DESC_CONTENT_FIRST_RE.exec(html)?.[1];
	return {
		title: title ? decodeEntities(title).trim() : null,
		description: description ? decodeEntities(description).trim() : null,
	};
}
