import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	decodeEntities,
	extractMetadata,
	htmlToMarkdown,
} from "../src/convert.js";

const md = (html: string) => htmlToMarkdown(html, { extractMain: true });

describe("raw text elements", () => {
	// `<n` matches the tag pattern, so the attribute run swallowed the closing
	// </script> and every element after it. The page converted to nothing.
	it("survives a '<' inside a script", () => {
		assert.equal(
			md("<main><script>for(i=0;i<n;i++){}</script><p>after</p></main>"),
			"after",
		);
		assert.equal(
			md("<main><script>if(a<b){}</script><p>after</p></main>"),
			"after",
		);
	});

	it("survives a '<' inside a style block", () => {
		assert.equal(
			md("<main><style>@media(a<b){}</style><p>after</p></main>"),
			"after",
		);
	});

	it("drops script and style content entirely", () => {
		assert.equal(md("<main><script>var a=1;</script><p>x</p></main>"), "x");
		assert.equal(md("<main><style>.a{color:red}</style><p>x</p></main>"), "x");
		assert.equal(
			md(
				`<main><script type="application/ld+json">{"a":1}</script><p>x</p></main>`,
			),
			"x",
		);
	});

	it("keeps a markup-looking string inside a script out of the output", () => {
		assert.equal(
			md(
				"<main><script>d.innerHTML='</div><p>ghost</p>'</script><p>x</p></main>",
			),
			"x",
		);
	});

	it("does not loop or throw on an unterminated script", () => {
		assert.equal(md("<main><p>before</p><script>a<b"), "before");
	});
});

describe("entities", () => {
	it("decodes Latin-1 names, case-sensitively", () => {
		assert.equal(md("<main><p>caf&eacute;</p></main>"), "café");
		assert.equal(md("<main><p>&Eacute;cole</p></main>"), "École");
		assert.equal(
			md("<main><p>M&uuml;ller ni&ntilde;o</p></main>"),
			"Müller niño",
		);
	});

	// Deliberate ASCII forms predate the Latin-1 table and still win.
	it("keeps the ASCII transliterations", () => {
		assert.equal(
			md("<main><p>&copy; &reg; &deg;</p></main>"),
			"(c) (r) degrees",
		);
		assert.equal(md("<main><p>a&mdash;b&hellip;</p></main>"), "a-b...");
	});

	it("decodes numeric and hex forms", () => {
		assert.equal(decodeEntities("a&#8212;b"), "a—b");
		assert.equal(decodeEntities("a&#x2014;b"), "a—b");
	});

	it("leaves an unknown entity alone", () => {
		assert.equal(md("<main><p>a&notreal;b</p></main>"), "a&notreal;b");
	});
});

describe("structure", () => {
	it("handles unclosed block tags", () => {
		assert.equal(md("<main><p>one<p>two</main>"), "one\ntwo");
	});

	it("does not break on '<' inside an attribute value", () => {
		assert.equal(
			md(`<main><a href="/x" title="a < b">link</a></main>`),
			'[link](/x "a < b")',
		);
	});

	it("strips comments, including ones containing tags", () => {
		assert.equal(
			md("<main><!-- <p>hidden</p> --><p>shown</p></main>"),
			"shown",
		);
	});

	it("nests lists", () => {
		assert.equal(
			md("<main><ul><li>a<ul><li>b</li></ul></li></ul></main>"),
			"- a\n\n  - b",
		);
	});

	it("renders a table", () => {
		assert.equal(
			md("<main><table><tr><th>h</th></tr><tr><td>c</td></tr></table></main>"),
			"| h |\n| --- |\n| c |",
		);
	});

	it("keeps pre content unescaped", () => {
		assert.equal(
			md("<main><pre><code>const a = 1 &lt; 2;</code></pre></main>"),
			"```\nconst a = 1 < 2;\n```",
		);
	});

	it("drops inline svg", () => {
		assert.equal(
			md("<main><p>a</p><svg><path d='M0 0'/></svg><p>b</p></main>"),
			"a\n\nb",
		);
	});
});

describe("extractMetadata", () => {
	// title is a raw text element too, so the tokenizer change must not move it.
	it("reads title and description", () => {
		const meta = extractMetadata(
			`<html><head><title>T</title><meta name="description" content="D"></head><body><p>x</p></body></html>`,
		);
		assert.equal(meta.title, "T");
		assert.equal(meta.description, "D");
	});

	it("decodes entities in the title", () => {
		const meta = extractMetadata(
			"<html><head><title>caf&eacute;</title></head></html>",
		);
		assert.equal(meta.title, "café");
	});
});

describe("tables", () => {
	// thead/tbody are block tags, so closing them flushed a blank line - which
	// ends a table in markdown, leaving the body as a second, headerless one.
	it("keeps a thead/tbody table in one piece", () => {
		const html =
			"<table><thead><tr><th>h1</th><th>h2</th></tr></thead>" +
			"<tbody><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></tbody></table>";
		assert.equal(md(html), "| h1 | h2 |\n| --- | --- |\n| a | b |\n| c | d |");
	});

	it("escapes a pipe in a cell", () => {
		assert.equal(
			md("<table><tr><th>a|b</th></tr><tr><td>c|d</td></tr></table>"),
			"| a\\|b |\n| --- |\n| c\\|d |",
		);
	});
});

describe("code fences", () => {
	it("carries the language across from the code element", () => {
		assert.equal(
			md('<pre><code class="language-js">const a=1;</code></pre>'),
			"```js\nconst a=1;\n```",
		);
		assert.equal(
			md('<pre><code class="lang-ts">let a: number;</code></pre>'),
			"```ts\nlet a: number;\n```",
		);
	});

	it("leaves the fence bare when there is no language", () => {
		assert.equal(md("<pre><code>plain</code></pre>"), "```\nplain\n```");
	});

	// preFenceIndex has to reset, or the second block rewrites the first fence.
	it("does not leak the language into the next block", () => {
		assert.equal(
			md(
				'<pre><code class="language-js">a</code></pre><pre><code>b</code></pre>',
			),
			"```js\na\n```\n\n```\nb\n```",
		);
	});
});

describe("nothing is dropped", () => {
	it("keeps an ordered list's start number", () => {
		assert.equal(md('<ol start="3"><li>a</li><li>b</li></ol>'), "3. a\n\n4. b");
		assert.equal(md("<ol><li>a</li></ol>"), "1. a");
	});

	it("keeps a link title", () => {
		assert.equal(md('<a href="/x" title="T">l</a>'), '[l](/x "T")');
		assert.equal(md('<a href="/x">l</a>'), "[l](/x)");
	});

	it("keeps an abbreviation's expansion", () => {
		assert.equal(
			md('<p><abbr title="HyperText">HTML</abbr> rules</p>'),
			"HTML (HyperText) rules",
		);
	});

	// An embed has no text, so skipping the element left no trace of it at all.
	it("keeps an iframe as a link", () => {
		assert.equal(
			md('<iframe src="https://v.example/x" title="Demo"></iframe>'),
			"[Demo](https://v.example/x)",
		);
		assert.equal(
			md('<iframe src="https://m.example/x"></iframe>'),
			"[Embedded content](https://m.example/x)",
		);
		assert.equal(md("<p>a</p><iframe></iframe><p>b</p>"), "a\n\nb");
	});

	it("distinguishes definition terms from definitions", () => {
		assert.equal(
			md("<dl><dt>Term</dt><dd>Definition</dd></dl>"),
			"- **Term**\n\n  Definition",
		);
	});

	it("keeps a details summary distinct from its body", () => {
		assert.equal(
			md("<details><summary>More</summary><p>body</p></details>"),
			"**More**\n\nbody",
		);
	});

	// The fence has to outrun the longest backtick run inside it.
	it("does not let content break out of a code fence", () => {
		const fence = "`".repeat(3);
		assert.equal(
			md(`<pre><code>a\n${fence}\nb</code></pre>`),
			"````\na\n```\nb\n````",
		);
	});
});

describe("list items with block content", () => {
	// A block element opening inside <li> flushed the bare marker, so the text
	// landed unindented and markdown read it as a sibling, not part of the item.
	it("keeps later paragraphs inside the item", () => {
		assert.equal(
			md("<ul><li><p>first</p><p>second</p></li><li>next</li></ul>"),
			"- first\n\n  second\n\n- next",
		);
	});

	it("keeps the marker when the item opens with a heading", () => {
		assert.equal(md("<ul><li><h3>h</h3></li></ul>"), "- ### h");
		assert.equal(
			md("<ul><li><h3>h</h3><p>body</p></li></ul>"),
			"- ### h\n\n  body",
		);
	});

	it("still nests plain lists", () => {
		assert.equal(md("<ul><li>a<ul><li>b</li></ul></li></ul>"), "- a\n\n  - b");
	});

	it("leaves a heading outside a list alone", () => {
		assert.equal(md("<h3>h</h3>"), "### h");
	});
});

describe("nested tables", () => {
	// Markdown has no nested table, so the inner one folds into the cell rather
	// than closing the outer row and stranding both.
	it("flattens the inner table into its cell", () => {
		assert.equal(
			md(
				"<table><tr><th>outer</th></tr><tr><td>before <table><tr><td>in1</td><td>in2</td></tr></table> after</td></tr></table>",
			),
			"| outer |\n| --- |\n| before in1 in2 after |",
		);
	});

	it("still separates two sibling tables", () => {
		assert.equal(
			md(
				"<table><tr><th>a</th></tr></table><table><tr><th>b</th></tr></table>",
			),
			"| a |\n| --- |\n\n| b |\n| --- |",
		);
	});
});
