#!/usr/bin/env node
import { BEACON_INGEST_PATH } from "../protocol.js";
import { startBeaconServer } from "../server/app.js";
import { configFromEnv } from "../server/config.js";

async function main(): Promise<void> {
	const config = configFromEnv();
	const started = await startBeaconServer(config);
	console.log(
		`[beacon] listening on http://${config.host}:${started.port}${BEACON_INGEST_PATH} (${config.keys.length} key(s), ip mode: ${config.ipMode})`,
	);
	let closing = false;
	const shutdown = (signal: string): void => {
		if (closing) {
			return;
		}
		closing = true;
		console.log(`[beacon] ${signal} received, shutting down`);
		started
			.close()
			.then(() => process.exit(0))
			.catch((err: Error) => {
				console.error(`[beacon] shutdown failed: ${err.message}`);
				process.exit(1);
			});
	};
	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((err: Error) => {
	console.error(`[beacon] ${err.message}`);
	process.exit(1);
});
