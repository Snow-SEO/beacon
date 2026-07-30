import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createBeacon } from "../src/beacon.js";
import { createDirResolver } from "../src/dir-resolver.js";
import { generateTwins, routeForHtmlFile } from "../src/generate.js";

const SITE = "https://example.com";

const HOME_HEADING = /# Home/;

const PRIVACY_BODY = /delete it quickly/;

const LLMS_TITLE = /# example\.com/;

const LLMS_PRIVACY_LINK = /https:\/\/example\.com\/privacy\.md/;

const SITEMAP_INDEX_LOC = /<loc>https:\/\/example\.com\/index\.md<\/loc>/;

const NEEDS_DIR = /needs either `dir`/;

const PRIVACY_TWIN = /We keep very little/;

function page(title: string, body: string): string {
	return `<!doctype html><html><head><title>${title}</title><meta name="description" content="About ${title}."></head><body><nav>Home Pricing</nav><main>${body}</main><footer>Copyright</footer></body></html>`;
}

function prose(heading: string, text: string): string {
	return `<h1>${heading}</h1><p>${text}</p><p>Every page on this site has a Markdown twin generated at build time.</p>`;
}

const SPA_SHELL =
	'<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>';

async function fixture(files: Record<string, string>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "beacon-"));
	for (const [name, contents] of Object.entries(files)) {
		const file = join(dir, name);
		await mkdir(join(file, ".."), { recursive: true });
		await writeFile(file, contents, "utf8");
	}
	return dir;
}
describe("routeForHtmlFile", () => {
	it("maps build output to routes", () => {
		assert.equal(routeForHtmlFile("index.html"), "/");
		assert.equal(routeForHtmlFile("privacy/index.html"), "/privacy");
		assert.equal(routeForHtmlFile("about.html"), "/about");
		assert.equal(routeForHtmlFile("blog/post/index.html"), "/blog/post");
	});
	it("normalizes Windows separators, because a route is a URL path", () => {
		assert.equal(routeForHtmlFile("blog\\post\\index.html"), "/blog/post");
	});
});
describe("generateTwins", () => {
	it("writes a twin beside each page, plus llms.txt and sitemap-md.xml", async () => {
		const dir = await fixture({
			"index.html": page(
				"Home",
				prose("Home", "Welcome to the site and everything it does."),
			),
			"privacy/index.html": page(
				"Privacy",
				prose("Privacy", "We keep very little and delete it quickly."),
			),
		});
		const result = await generateTwins({ dir, siteUrl: SITE });
		assert.equal(result.twins.length, 2);
		assert.equal(result.allEmpty, false);
		const home = await readFile(join(dir, "index.md"), "utf8");
		assert.match(home, HOME_HEADING);
		const privacy = await readFile(join(dir, "privacy.md"), "utf8");
		assert.match(privacy, PRIVACY_BODY);
		const llms = await readFile(join(dir, "llms.txt"), "utf8");
		assert.match(llms, LLMS_TITLE);
		assert.match(llms, LLMS_PRIVACY_LINK);
		const sitemap = await readFile(join(dir, "sitemap-md.xml"), "utf8");
		assert.match(sitemap, SITEMAP_INDEX_LOC);
	});
	it("refuses to write a twin for a page with no rendered body", async () => {
		const dir = await fixture({ "index.html": SPA_SHELL });
		const result = await generateTwins({ dir, siteUrl: SITE });
		assert.equal(result.twins.length, 0);
		assert.equal(result.allEmpty, true);
		assert.equal(result.skipped[0]?.reason, "empty");
		await assert.rejects(() => readFile(join(dir, "index.md"), "utf8"));
	});
	it("does not report allEmpty when only some pages are thin", async () => {
		const dir = await fixture({
			"index.html": page(
				"Home",
				prose("Home", "A real page with real prose on it."),
			),
			"app/index.html": SPA_SHELL,
		});
		const result = await generateTwins({ dir, siteUrl: SITE });
		assert.equal(result.twins.length, 1);
		assert.equal(result.allEmpty, false);
	});
	it("skips excluded routes and ignores asset directories", async () => {
		const dir = await fixture({
			"index.html": page(
				"Home",
				prose("Home", "Welcome to the site and everything it does."),
			),
			"admin/index.html": page(
				"Admin",
				prose("Admin", "Internal tools for staff only."),
			),
			"assets/chunk.html": page(
				"Chunk",
				prose("Chunk", "Not a route, just a build artifact."),
			),
		});
		const result = await generateTwins({
			dir,
			siteUrl: SITE,
			exclude: ["/admin"],
		});
		assert.deepEqual(
			result.twins.map((twin) => twin.route),
			["/"],
		);
		assert.equal(
			result.skipped.some(
				(s) => s.route === "/admin" && s.reason === "excluded",
			),
			true,
		);
	});
	it("dryRun reports staleness without touching disk", async () => {
		const dir = await fixture({
			"index.html": page(
				"Home",
				prose("Home", "Welcome to the site and everything it does."),
			),
		});
		const first = await generateTwins({ dir, siteUrl: SITE, dryRun: true });
		assert.equal(first.twins[0]?.unchanged, false);
		await assert.rejects(() => readFile(join(dir, "index.md"), "utf8"));
		await generateTwins({ dir, siteUrl: SITE });
		const second = await generateTwins({ dir, siteUrl: SITE, dryRun: true });
		assert.equal(second.twins[0]?.unchanged, true);
	});
});
describe("createDirResolver", () => {
	it("serves generated twins through Beacon with no route table", async () => {
		const dir = await fixture({
			"index.html": page(
				"Home",
				prose("Home", "Welcome to the site and everything it does."),
			),
			"privacy/index.html": page(
				"Privacy",
				prose("Privacy", "We keep very little and delete it quickly."),
			),
		});
		await generateTwins({ dir, siteUrl: SITE });
		const beacon = createBeacon({ siteUrl: SITE, dir });
		const twin = await beacon.handle(new Request(`${SITE}/privacy.md`));
		assert.equal(twin?.status, 200);
		assert.match(await (twin as Response).text(), PRIVACY_TWIN);
		const negotiated = await beacon.handle(
			new Request(`${SITE}/`, { headers: { accept: "text/markdown" } }),
		);
		assert.match(await (negotiated as Response).text(), HOME_HEADING);
		assert.equal(
			await beacon.handle(new Request(`${SITE}/dashboard.md`)),
			null,
		);
	});
	it("refuses to escape the twin directory", async () => {
		const dir = await fixture({ "index.md": "# Home" });
		const resolve = createDirResolver(dir);
		const request = new Request(`${SITE}/`);
		assert.equal(await resolve("/../../etc/passwd", request), null);
		assert.equal(await resolve("/..%2f..%2fetc/passwd", request), null);
	});
	it("requires either dir or resolve", () => {
		assert.throws(() => createBeacon({ siteUrl: SITE }), NEEDS_DIR);
	});
});
