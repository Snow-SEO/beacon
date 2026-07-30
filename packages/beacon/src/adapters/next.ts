import type { Beacon, HandleContext } from "../beacon.js";
import { isMarkdownPath } from "../paths.js";

export interface NextEventLike {
	waitUntil?: (promise: Promise<unknown>) => void;
}

export function beaconMiddleware(
	beacon: Beacon,
	request: Request,
	event?: NextEventLike,
): Promise<Response | null> {
	return beacon.handle(request, event as HandleContext);
}

export function beaconAdvertise(
	beacon: Beacon,
	request: Request,
	response: Response,
	event?: NextEventLike,
): Promise<Response> {
	if (isMarkdownPath(new URL(request.url).pathname)) {
		return Promise.resolve(response);
	}
	return beacon.advertiseIfPresent(request, response, event as HandleContext);
}

export function createBeaconRouteHandler(beacon: Beacon): {
	GET: (request: Request) => Promise<Response>;
} {
	return {
		GET: async (request: Request) => {
			const response = await beacon.handle(request);
			return (
				response ??
				new Response("Not Found", {
					status: 404,
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				})
			);
		},
	};
}
