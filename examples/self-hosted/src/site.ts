import { createBeacon } from "@snowseo/beacon";
import { beaconExpress } from "@snowseo/beacon/node";
import express from "express";

const SITE_URL = process.env.SITE_URL ?? "http://localhost:3000";
const PORT = Number(process.env.PORT ?? 3000);

const beacon = createBeacon({
	siteUrl: SITE_URL,
	dir: "site",
	analytics: {
		key: process.env.BEACON_KEY ?? "local-dev-key",
		endpoint: process.env.BEACON_ENDPOINT ?? "http://127.0.0.1:8787",
		onError: (error) => console.error("[beacon] send failed:", error),
		onHit: (hit, match) =>
			console.log(`[beacon] ${match.agent} -> ${hit.path}`),
	},
});

const app = express();

app.use(beaconExpress(beacon));
app.use(express.static("site", { extensions: ["html"] }));

app.listen(PORT, () => {
	console.log(`site      http://localhost:${PORT}`);
	console.log(
		`collector ${process.env.BEACON_ENDPOINT ?? "http://127.0.0.1:8787"}`,
	);
	console.log("\nTry:");
	console.log(`  curl -A 'GPTBot/1.2' http://localhost:${PORT}/`);
	console.log(`  curl -H 'Accept: text/markdown' http://localhost:${PORT}/`);
});
