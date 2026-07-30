import { createBeacon } from "@snowseo/beacon";
import { findDoc } from "./content";

export const beacon = createBeacon({
	siteUrl: process.env.SITE_URL ?? "http://localhost:3000",
	resolve: (path) => findDoc(path)?.markdown ?? null,
	...(process.env.SNOWSEO_BEACON_KEY
		? {
				analytics: {
					key: process.env.SNOWSEO_BEACON_KEY,
					endpoint: process.env.BEACON_ENDPOINT,
					onError: (error: unknown) => console.error("[beacon]", error),
				},
			}
		: {}),
});
