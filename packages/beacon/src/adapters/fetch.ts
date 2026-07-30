import type { Beacon, HandleContext } from "../beacon.js";

export interface FetchMiddlewareContext extends HandleContext {
	request: Request;
}

const HTML_TYPE = "text/html";

export function createFetchMiddleware(
	beacon: Beacon,
): (
	context: FetchMiddlewareContext,
	next: () => Promise<Response>,
) => Promise<Response> {
	return async (context, next) => {
		const { request, waitUntil } = context;

		const markdown = await beacon.handle(request, { waitUntil });
		if (markdown) {
			return markdown;
		}
		const response = await next();
		if (!response.headers.get("content-type")?.includes(HTML_TYPE)) {
			return response;
		}
		return beacon.advertiseIfPresent(request, response, {
			waitUntil,
			statusCode: response.status,
		});
	};
}
