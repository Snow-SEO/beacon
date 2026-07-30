import { createHmac, randomBytes } from "node:crypto";

export type IpMode = "hash" | "raw" | "discard";

const HASH_LENGTH = 32;

export function createIpTransform(
	mode: IpMode,
	salt?: string,
): (ip: string) => string | null {
	if (mode === "discard") {
		return () => null;
	}
	if (mode === "raw") {
		return (ip) => ip;
	}
	if (!salt) {
		console.warn(
			"[beacon] no IP hash salt configured; hashes will not be stable across restarts. Set BEACON_IP_SALT.",
		);
	}
	const key = salt ?? randomBytes(32).toString("hex");
	return (ip) =>
		createHmac("sha256", key).update(ip).digest("hex").slice(0, HASH_LENGTH);
}
