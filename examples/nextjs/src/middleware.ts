import { beaconAdvertise, beaconMiddleware } from "@snowseo/beacon/next";
import {
	type NextFetchEvent,
	type NextRequest,
	NextResponse,
} from "next/server";
import { beacon } from "@/lib/beacon";

export async function middleware(request: NextRequest, event: NextFetchEvent) {
	const markdown = await beaconMiddleware(beacon, request, event);
	if (markdown) {
		return markdown;
	}

	return beaconAdvertise(beacon, request, NextResponse.next(), event);
}

export const config = {
	matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
