import type { Beacon } from "../beacon.js";
import { toMarkdownPath } from "../paths.js";

const TRAILING_SLASHES = /\/+$/;

export interface NodeRequestLike {
	url?: string;
	method?: string;
	headers: Record<string, string | string[] | undefined>;
	socket?: {
		encrypted?: boolean;
	};
}

export interface NodeResponseLike {
	statusCode: number;
	setHeader: (name: string, value: string) => void;
	getHeader: (name: string) => string | number | string[] | undefined;
	end: (chunk?: string) => void;
	headersSent: boolean;
}

function headerValue(value: string | string[] | undefined): string | undefined {
	if (Array.isArray(value)) {
		return value[0];
	}
	return value;
}

export function toFetchRequest(req: NodeRequestLike, siteUrl: string): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		const single = headerValue(value);
		if (single !== undefined) {
			headers.set(name, single);
		}
	}
	const base = siteUrl.replace(TRAILING_SLASHES, "");
	return new Request(`${base}${req.url ?? "/"}`, {
		method: req.method ?? "GET",
		headers,
	});
}

export function beaconExpress(beacon: Beacon) {
	return async (
		req: NodeRequestLike,
		res: NodeResponseLike,
		next: (error?: unknown) => void,
	): Promise<void> => {
		try {
			const request = toFetchRequest(req, beacon.siteUrl);
			const response = await beacon.handle(request);
			if (!response) {
				if (!res.headersSent) {
					const url = new URL(request.url);
					if (await beacon.hasTwin(url.pathname, request)) {
						const link = `<${toMarkdownPath(url.pathname)}>; rel="alternate"; type="text/markdown"`;
						const existingLink = res.getHeader("Link");
						res.setHeader(
							"Link",
							existingLink ? `${String(existingLink)}, ${link}` : link,
						);
						const existingVary = res.getHeader("Vary");
						const vary = String(existingVary ?? "");
						if (!vary.toLowerCase().includes("accept")) {
							res.setHeader("Vary", vary ? `${vary}, Accept` : "Accept");
						}
					}
					beacon.track(request, { format: "html" });
				}
				next();
				return;
			}
			res.statusCode = response.status;
			response.headers.forEach((value, name) => {
				res.setHeader(name, value);
			});
			res.end(await response.text());
		} catch (error) {
			next(error);
		}
	};
}
