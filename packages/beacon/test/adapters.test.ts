import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	createFetchMiddleware,
	type FetchMiddlewareContext,
} from "../src/adapters/fetch.js";
import {
	beaconAdvertise,
	beaconMiddleware,
	createBeaconRouteHandler,
} from "../src/adapters/next.js";
import {
	beaconExpress,
	type NodeRequestLike,
	type NodeResponseLike,
	toFetchRequest,
} from "../src/adapters/node.js";
import { createBeacon } from "../src/beacon.js";

const MARKDOWN_TYPE = /text\/markdown/;

const beacon = createBeacon({
	siteUrl: "https://e.com",
	resolve: (path) => (path === "/pricing" ? "# Pricing" : null),
});

function fakeRes(): NodeResponseLike & {
	headers: Map<string, string>;
} {
	const headers = new Map<string, string>();
	return {
		headers,
		statusCode: 200,
		headersSent: false,
		setHeader(name, value) {
			headers.set(name.toLowerCase(), value);
		},
		getHeader(name) {
			return headers.get(name.toLowerCase());
		},
		end() {},
	};
}

function run(
	req: NodeRequestLike,
	res: NodeResponseLike,
): Promise<{
	nexted: boolean;
}> {
	return new Promise((resolve, reject) => {
		beaconExpress(beacon)(req, res, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve({ nexted: true });
		}).then(() => resolve({ nexted: false }), reject);
	});
}
describe("node adapter", () => {
	it("advertises a relative twin, not the siteUrl origin", async () => {
		const res = fakeRes();
		await run({ url: "/pricing", method: "GET", headers: {} }, res);
		assert.equal(
			res.headers.get("link"),
			'</pricing.md>; rel="alternate"; type="text/markdown"',
		);
		assert.ok(!res.headers.get("link")?.includes("e.com"));
		assert.equal(res.headers.get("vary"), "Accept");
	});
	it("stays quiet on a page with no twin", async () => {
		const res = fakeRes();
		await run({ url: "/dashboard", method: "GET", headers: {} }, res);
		assert.equal(res.headers.get("link"), undefined);
		assert.equal(res.headers.get("vary"), undefined);
	});
	it("calls next() for an HTML request instead of terminating it", async () => {
		const res = fakeRes();
		const { nexted } = await run(
			{ url: "/pricing", method: "GET", headers: {} },
			res,
		);
		assert.equal(nexted, true);
	});
	it("serves the twin at the .md URL", async () => {
		const res = fakeRes();
		await run({ url: "/pricing.md", method: "GET", headers: {} }, res);
		assert.equal(res.statusCode, 200);
		assert.match(res.headers.get("content-type") ?? "", MARKDOWN_TYPE);
		assert.equal(
			res.headers.get("link"),
			'<https://e.com/pricing>; rel="canonical"',
		);
	});
	it("appends to an existing Link rather than clobbering it", async () => {
		const res = fakeRes();
		res.setHeader("Link", '</style.css>; rel="preload"');
		await run({ url: "/pricing", method: "GET", headers: {} }, res);
		const link = res.headers.get("link") ?? "";
		assert.ok(link.includes('rel="preload"'));
		assert.ok(link.includes('rel="alternate"'));
	});
	it("does not duplicate Accept in an existing Vary", async () => {
		const res = fakeRes();
		res.setHeader("Vary", "Accept-Encoding, Accept");
		await run({ url: "/pricing", method: "GET", headers: {} }, res);
		assert.equal(res.headers.get("vary"), "Accept-Encoding, Accept");
	});
	it("flattens repeated headers when building the Request", () => {
		const request = toFetchRequest(
			{
				url: "/pricing",
				method: "GET",
				headers: { accept: ["text/markdown", "text/html"] },
			},
			"https://e.com/",
		);
		assert.equal(request.url, "https://e.com/pricing");
		assert.equal(request.headers.get("accept"), "text/markdown");
	});
});
describe("next adapter", () => {
	it("returns markdown for a twin request and null otherwise", async () => {
		assert.ok(
			await beaconMiddleware(beacon, new Request("https://e.com/pricing.md")),
		);
		assert.equal(
			await beaconMiddleware(beacon, new Request("https://e.com/dashboard")),
			null,
		);
	});
	it("does not advertise a twin on the twin's own response", async () => {
		const res = await beaconAdvertise(
			beacon,
			new Request("https://e.com/pricing.md"),
			new Response("# Pricing"),
		);
		assert.equal(res.headers.get("link"), null);
	});
	it("advertises a relative twin on an HTML response", async () => {
		const res = await beaconAdvertise(
			beacon,
			new Request("https://e.com/pricing"),
			new Response("<html></html>"),
		);
		assert.equal(
			res.headers.get("link"),
			'</pricing.md>; rel="alternate"; type="text/markdown"',
		);
	});
	it("does not advertise a twin for a page that has none", async () => {
		const res = await beaconAdvertise(
			beacon,
			new Request("https://e.com/dashboard"),
			new Response("<html></html>"),
		);
		assert.equal(res.headers.get("link"), null);
	});
	it("route handler 404s an unmapped path rather than serving empty markdown", async () => {
		const { GET } = createBeaconRouteHandler(beacon);
		assert.equal(
			(await GET(new Request("https://e.com/pricing.md"))).status,
			200,
		);
		assert.equal(
			(await GET(new Request("https://e.com/missing.md"))).status,
			404,
		);
	});
});

describe("fetch adapter", () => {
	function astroLikeContext(request: Request): FetchMiddlewareContext {
		const context = { request } as FetchMiddlewareContext;
		Object.defineProperty(context, "clientAddress", {
			enumerable: true,
			get() {
				throw new Error("clientAddress is not available on prerendered routes");
			},
		});
		return context;
	}

	it("serves a twin without touching unrelated context properties", async () => {
		const request = new Request("https://e.com/pricing", {
			headers: { accept: "text/markdown" },
		});
		const middleware = createFetchMiddleware(beacon);

		const response = await middleware(astroLikeContext(request), () => {
			throw new Error("next() should not run when a twin is served");
		});

		assert.equal(response.status, 200);
		assert.match(response.headers.get("content-type") ?? "", MARKDOWN_TYPE);
	});

	it("advertises a twin without touching unrelated context properties", async () => {
		const request = new Request("https://e.com/pricing");
		const middleware = createFetchMiddleware(beacon);
		const html = new Response("<h1>Pricing</h1>", {
			headers: { "content-type": "text/html" },
		});

		const response = await middleware(
			astroLikeContext(request),
			async () => html,
		);

		assert.match(
			response.headers.get("link") ?? "",
			/<\/pricing\.md>; rel="alternate"/,
		);
		assert.match(response.headers.get("vary") ?? "", /Accept/);
	});

	it("passes a page with no twin straight through", async () => {
		const request = new Request("https://e.com/about");
		const middleware = createFetchMiddleware(beacon);
		const html = new Response("<h1>About</h1>", {
			headers: { "content-type": "text/html" },
		});

		const response = await middleware(
			astroLikeContext(request),
			async () => html,
		);

		assert.equal(response.headers.get("link"), null);
	});
});
