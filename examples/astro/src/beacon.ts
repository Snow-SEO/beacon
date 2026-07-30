import { createBeacon } from "@snowseo/beacon";

export const beacon = createBeacon({
	siteUrl: import.meta.env.SITE ?? "http://localhost:4321",
	dir: "dist",
	...(import.meta.env.SNOWSEO_BEACON_KEY
		? {
				analytics: {
					key: import.meta.env.SNOWSEO_BEACON_KEY,
					endpoint: import.meta.env.BEACON_ENDPOINT,
					onError: (error: unknown) => console.error("[beacon]", error),
				},
			}
		: {}),
});
