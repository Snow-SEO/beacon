import { createHash, timingSafeEqual } from "node:crypto";

export interface BeaconKey {
	key: string;
	allowedHosts?: readonly string[];
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

export class KeyRegistry {
	private readonly entries: {
		hash: Buffer;
		key: BeaconKey;
	}[];
	constructor(keys: readonly BeaconKey[]) {
		this.entries = keys.map((key) => ({ hash: digest(key.key), key }));
	}
	get size(): number {
		return this.entries.length;
	}
	lookup(presented: string | undefined): BeaconKey | null {
		if (!presented) {
			return null;
		}
		const candidate = digest(presented);
		let found: BeaconKey | null = null;
		for (const entry of this.entries) {
			if (timingSafeEqual(candidate, entry.hash)) {
				found = entry.key;
			}
		}
		return found;
	}
}

const KEY_SEPARATOR_RE = /[;\s]+/;

export function parseKeysFromEnv(raw: string | undefined): BeaconKey[] {
	if (!raw) {
		return [];
	}
	return raw
		.split(KEY_SEPARATOR_RE)
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const at = entry.indexOf("@");
			if (at === -1) {
				return { key: entry };
			}
			const hosts = entry
				.slice(at + 1)
				.split(",")
				.map((h) => h.trim())
				.filter(Boolean);
			return {
				key: entry.slice(0, at),
				allowedHosts: hosts.length > 0 ? hosts : undefined,
			};
		})
		.filter((entry) => entry.key.length > 0);
}
