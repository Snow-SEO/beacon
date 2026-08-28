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
	"object",
	"form",
]);

const CHROME_TAGS = new Set(["nav", "aside", "dialog"]);

const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

function chromeHeaderTokens(tokens: Token[]): Set<number> {
	const drop = new Set<number>();
	for (const [i, token] of tokens.entries()) {
		if (token.kind !== "open" || token.tag !== "header" || token.selfClosing) {
			continue;
		}
		let depth = 1;
		let hasHeading = false;
		for (let j = i + 1; j < tokens.length; j += 1) {
			const inner = tokens[j];
			if (!inner) {
				break;
			}
			if (
				inner.kind === "open" &&
				inner.tag === "header" &&
				!inner.selfClosing
			) {
				depth += 1;
			} else if (inner.kind === "close" && inner.tag === "header") {
				depth -= 1;
				if (depth === 0) {
					break;
				}
			}
			if (inner.kind === "open" && HEADING_TAGS.has(inner.tag)) {
				hasHeading = true;
				break;
			}
		}
		if (!hasHeading) {
			drop.add(i);
		}
	}
	return drop;
}

const BOILERPLATE_RE =
	/(?:^|[\s_-])(?:cookie|consent|gdpr|banner|breadcrumbs?|navbar|navigation|sidebar|site-?header|site-?footer|masthead|newsletter|subscribe|popup|modal|overlay|backdrop|advert|advertisement|sponsored|social-?share|share-?buttons?|skip-?link|sr-only|visually-?hidden|screen-?reader)(?:[\s_-]|$)/i;

const HIDDEN_STYLE_RE = /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;

const GENERIC_ALT_RE =
	/^(?:brand[\s_-]*)?(?:logo|icon|image|img|photo|picture|graphic|illustration|avatar|thumbnail|banner)[\s_-]*\d*$/i;

function isDecorativeImage(attrs: Record<string, string>): boolean {
	if ("alt" in attrs && attrs.alt?.trim() === "") {
		return true;
	}
	if (attrs.role === "presentation" || attrs.role === "none") {
		return true;
	}
	const alt = attrs.alt?.trim();
	return Boolean(alt && GENERIC_ALT_RE.test(alt));
}

function shouldDropElement(
	tag: string,
	attrs: Record<string, string>,
	insideArticle: boolean,
): boolean {
	if (!insideArticle && CHROME_TAGS.has(tag)) {
		return true;
	}
	if ("hidden" in attrs || attrs["aria-hidden"] === "true") {
		return true;
	}
	const style = attrs.style;
	if (style && HIDDEN_STYLE_RE.test(style)) {
		return true;
	}
	const className = attrs.class;
	if (className && BOILERPLATE_RE.test(className)) {
		return true;
	}
	const id = attrs.id;
	return Boolean(id && BOILERPLATE_RE.test(id));
}

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

// The HTML Latin-1 entities are contiguous from 160, so the names alone carry
// the table. Without them `caf&eacute;` reached the twin verbatim, which is how
// most older CMSs write accented text. Existing entries above win, keeping the
// deliberate ASCII forms (`copy` stays "(c)", not "©").
const LATIN1_ENTITY_NAMES =
	"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";

for (const [offset, name] of LATIN1_ENTITY_NAMES.split(" ").entries()) {
	if (!(name in NAMED_ENTITIES)) {
		NAMED_ENTITIES[name] = String.fromCharCode(160 + offset);
	}
}

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
		return (
			NAMED_ENTITIES[entity] ?? NAMED_ENTITIES[entity.toLowerCase()] ?? match
		);
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

// The value is optional so boolean attributes (`hidden`, `open`, `disabled`)
// are recorded at all. Requiring `=` meant `<div hidden>` parsed to no
// attributes, so nothing could act on it. Safe because TAG_RE hands this the
// attribute run only, never the tag name.
const ATTR_RE =
	/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

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

const CODE_LANGUAGE_RE = /(?:^|\s)(?:language|lang)-([a-zA-Z0-9+#.-]+)/;

const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

function closeTagIndex(
	rest: string,
	tag: string,
): { content: number; after: number } {
	const close = new RegExp(`</${tag}(?:\\s[^>]*)?>`, "i");
	const found = close.exec(rest);
	// Unterminated: treat the remainder as content, so a truncated page loses
	// only what came after the opening tag rather than looping.
	return found
		? { content: found.index, after: found.index + found[0].length }
		: { content: rest.length, after: rest.length };
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
		const isClose = Boolean(match[1]);
		const selfClosing = Boolean(match[4]) || VOID_TAGS.has(tag);
		tokens.push({
			kind: isClose ? "close" : "open",
			tag,
			attrs: isClose ? {} : parseAttrs(match[3] ?? ""),
			text: "",
			selfClosing,
		});
		lastIndex = match.index + match[0].length;

		// Raw text elements hold no markup, so their contents must be taken
		// verbatim rather than scanned for tags. `for (i = 0; i < n; i++)` in a
		// script would otherwise tokenize as an open `<n>` whose attributes run
		// to the next `>`, swallowing the `</script>` and every element after
		// it - the whole page converted to nothing.
		if (!(isClose || selfClosing) && RAW_TEXT_TAGS.has(tag)) {
			const rest = html.slice(lastIndex);
			const end = closeTagIndex(rest, tag);
			pushText(rest.slice(0, end.content));
			tokens.push({
				kind: "close",
				tag,
				attrs: {},
				text: "",
				selfClosing: false,
			});
			lastIndex += end.after;
			TAG_RE.lastIndex = lastIndex;
		}

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

const ARTICLE_COUNT_RE = /<article[^>]*>/gi;

const FOOTER_BLOCK_RE = /<footer[^>]*>[\s\S]*?<\/footer>/i;

function withPageFooter(slice: string, full: string): string {
	if (/<footer[\s>]/i.test(slice)) {
		return slice;
	}
	const found = FOOTER_BLOCK_RE.exec(full);
	return found ? `${slice}\n${found[0]}` : slice;
}

interface Container {
	html: string;
	tag: string | null;
}

function extractContainer(html: string): Container {
	const articleCount = (html.match(ARTICLE_COUNT_RE) ?? []).length;
	for (const { tag, re } of CONTAINERS) {
		if (tag === "article" && articleCount !== 1) {
			continue;
		}
		const open = re.exec(html);
		if (open) {
			const start = open.index + open[0].length;
			const close = html.toLowerCase().lastIndexOf(`</${tag}>`);
			if (close > start) {
				return { html: withPageFooter(html.slice(start, close), html), tag };
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
			return {
				html: withPageFooter(html.slice(start, close), html),
				tag: roleMain[1].toLowerCase(),
			};
		}
	}
	const body = BODY_OPEN_RE.exec(html);
	if (body) {
		const start = body.index + body[0].length;
		const close = html.toLowerCase().lastIndexOf("</body>");
		return {
			html: close > start ? html.slice(start, close) : html.slice(start),
			tag: "body",
		};
	}
	return { html, tag: null };
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
	/** Marker written but not yet joined to content, e.g. "-" or "3.". */
	pendingMarker: string | null;
}

export function htmlToMarkdown(
	html: string,
	options: ConvertOptions = {},
): string {
	let source = stripEmptyInline(
		html.replace(COMMENT_RE, "").replace(DOCTYPE_RE, ""),
	);
	let containerTag: string | null = null;
	if (options.extractMain !== false) {
		const container = extractContainer(source);
		source = container.html;
		containerTag = container.tag;
	}
	const tokens = tokenize(source);
	const chromeHeaders = chromeHeaderTokens(tokens);
	const out: string[] = [];
	const lists: ListFrame[] = [];
	let skipDepth = 0;
	let skipTag = "";
	let articleDepth = containerTag === "article" ? 1 : 0;
	let preDepth = 0;
	let preFenceIndex = -1;
	let pendingTitle: string | null = null;
	let pendingAbbr: string | null = null;
	let quoteDepth = 0;
	let line = "";
	let pendingHref: string | null = null;
	let linkText = "";
	const tableRow: string[] = [];
	let tableCell: string | null = null;
	let tableRowCount = 0;
	let tableDepth = 0;
	const flushLine = () => {
		const trimmed = line.replace(/[ \t]+$/g, "");
		const frame = lists.at(-1);
		// Only the marker so far. Hold it, so it lands on the same line as the
		// item's first content rather than alone: a block element opening inside
		// an <li> flushes before any text has been written.
		if (frame?.pendingMarker && trimmed === frame.pendingMarker) {
			return;
		}
		if (trimmed.trim()) {
			// Everything after an item's first line has to be indented, or markdown
			// ends the item and reads the rest as a sibling paragraph.
			const body =
				frame && frame.pendingMarker === null
					? `${"  ".repeat(lists.length)}${trimmed}`
					: trimmed;
			if (frame) {
				frame.pendingMarker = null;
			}
			out.push(quoteDepth > 0 ? `${"> ".repeat(quoteDepth)}${body}` : body);
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
	for (const [index, token] of tokens.entries()) {
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
		if (tag === "article") {
			if (token.kind === "open" && !token.selfClosing) {
				articleDepth += 1;
			} else if (token.kind === "close" && articleDepth > 0) {
				articleDepth -= 1;
			}
		}
		if (
			token.kind === "open" &&
			(VOID_CONTENT_TAGS.has(tag) ||
				chromeHeaders.has(index) ||
				shouldDropElement(tag, attrs, articleDepth > 0))
		) {
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
				case "abbr":
					pendingAbbr = attrs.title ?? null;
					break;
				case "iframe": {
					const src = resolveUrl(attrs.src ?? "", options.baseUrl);
					if (src && !src.startsWith("data:")) {
						flushLine();
						out.push(`[${attrs.title || "Embedded content"}](${src})`, "");
					}
					skipDepth = 1;
					skipTag = "iframe";
					break;
				}
				case "dt":
					flushLine();
					line = "- **";
					break;
				case "dd":
					flushLine();
					line = "  ";
					break;
				case "summary":
					flushLine();
					line = "**";
					break;
				case "img": {
					const src = resolveUrl(attrs.src ?? "", options.baseUrl);
					if (src && !src.startsWith("data:") && !isDecorativeImage(attrs)) {
						write(`![${attrs.alt ?? ""}](${src})`);
					}
					break;
				}
				case "h1":
				case "h2":
				case "h3":
				case "h4":
				case "h5":
				case "h6": {
					flushLine();
					// A heading inside a list item would otherwise overwrite the
					// marker that flushLine is holding, dropping the item entirely.
					const held = lists.at(-1)?.pendingMarker;
					line = `${held ? `${held} ` : ""}${"#".repeat(Number(tag[1]))} `;
					break;
				}
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
				case "code": {
					if (preDepth === 0) {
						write("`");
						break;
					}
					const language = CODE_LANGUAGE_RE.exec(attrs.class ?? "")?.[1];
					// Only the first code element inside the block names it. The index
					// stays put: the closing tag still has to widen both fences if the
					// content itself contains backticks.
					if (language && preFenceIndex >= 0 && out[preFenceIndex] === "```") {
						out[preFenceIndex] = `\`\`\`${language.toLowerCase()}`;
					}
					break;
				}
				case "pre":
					flushLine();
					preDepth += 1;
					out.push("```");
					preFenceIndex = out.length - 1;
					break;
				case "blockquote":
					flushLine();
					quoteDepth += 1;
					break;
				case "ul":
				case "ol": {
					flushLine();
					const start = Number.parseInt(attrs.start ?? "", 10);
					lists.push({
						ordered: tag === "ol",
						index: Number.isFinite(start) && start > 0 ? start : 1,
						pendingMarker: null,
					});
					break;
				}
				case "li": {
					flushLine();
					line = listPrefix();
					const frame = lists.at(-1);
					if (frame) {
						frame.pendingMarker = line.trimEnd();
					}
					break;
				}
				case "a":
					pendingHref = attrs.href ?? "";
					pendingTitle = attrs.title ?? null;
					linkText = "";
					break;
				case "table":
					// Markdown has no nested table. A second one inside a cell would
					// close the outer row early and strand both, so the inner one only
					// writes its text into the cell it sits in.
					tableDepth += 1;
					if (tableDepth === 1) {
						flushLine();
						tableRowCount = 0;
					}
					break;
				case "tr":
					if (tableDepth <= 1) {
						tableRow.length = 0;
					}
					break;
				case "thead":
				case "tbody":
				case "tfoot":
					break;
				case "th":
				case "td":
					if (tableDepth <= 1) {
						tableCell = "";
					} else if (tableCell) {
						tableCell += " ";
					}
					break;
				default:
					break;
			}
			if (token.selfClosing && tag === "a") {
				pendingHref = null;
				pendingTitle = null;
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
			case "pre": {
				flushLine();
				preDepth = Math.max(0, preDepth - 1);
				// A page showing a fenced example holds ``` inside the block, which
				// closes it early and spills the rest out as prose. The fence has to
				// outrun the longest run the content holds, and both ends must agree,
				// so the opening line is rewritten to match.
				const body = preFenceIndex >= 0 ? out.slice(preFenceIndex + 1) : [];
				const longest = body.reduce(
					(max, line) =>
						Math.max(max, ...(line.match(/`+/g) ?? [""]).map((r) => r.length)),
					0,
				);
				const fence = "`".repeat(Math.max(3, longest + 1));
				const opener = preFenceIndex >= 0 ? out[preFenceIndex] : undefined;
				if (opener !== undefined) {
					out[preFenceIndex] = fence + opener.slice(3);
				}
				preFenceIndex = -1;
				out.push(fence, "");
				break;
			}
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
					frame.pendingMarker = null;
				}
				break;
			}
			case "a": {
				const href = resolveUrl(pendingHref ?? "", options.baseUrl);
				const text = linkText.trim();
				pendingHref = null;
				const title = pendingTitle
					? ` "${pendingTitle.replaceAll('"', "'")}"`
					: "";
				pendingTitle = null;
				const rendered = href && text ? `[${text}](${href}${title})` : text;
				linkText = "";
				write(rendered);
				break;
			}
			case "dt":
				write("**");
				flushLine();
				break;
			case "summary":
				write("**");
				flushLine();
				break;
			case "abbr":
				if (pendingAbbr) {
					write(` (${pendingAbbr})`);
					pendingAbbr = null;
				}
				break;
			case "th":
			case "td":
				if (tableDepth > 1) {
					break;
				}
				tableRow.push(
					(tableCell ?? "").replace(/\s+/g, " ").trim().replaceAll("|", "\\|"),
				);
				tableCell = null;
				break;
			case "tr":
				if (tableDepth > 1) {
					break;
				}
				if (tableRow.length > 0) {
					out.push(`| ${tableRow.join(" | ")} |`);
					tableRowCount += 1;
					if (tableRowCount === 1) {
						out.push(`| ${tableRow.map(() => "---").join(" | ")} |`);
					}
				}
				tableRow.length = 0;
				break;
			case "thead":
			case "tbody":
			case "tfoot":
				break;
			case "table":
				tableDepth = Math.max(0, tableDepth - 1);
				if (tableDepth === 0) {
					out.push("");
				}
				break;
			default:
				if (BLOCK_TAGS.has(tag)) {
					flushLine();
				}
				break;
		}
	}
	flushLine();
	return dedupeMediaLines(out)
		.join("\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

const MEDIA_ONLY_LINE_RE = /^!?\[[^\]]*\]\([^)]+\)$/;

function dedupeMediaLines(lines: string[]): string[] {
	const out: string[] = [];
	let previous: string | null = null;
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed && trimmed === previous && MEDIA_ONLY_LINE_RE.test(trimmed)) {
			continue;
		}
		out.push(line);
		if (trimmed) {
			previous = trimmed;
		}
	}
	return out;
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
