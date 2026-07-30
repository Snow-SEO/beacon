import type { DeferredVerification } from "./ingest.js";
import { verifyByReverseDns } from "./ip-verify.js";
import type { HitStore, VerdictUpdate } from "./store/types.js";

const DEFAULT_CONCURRENCY = 8;

export interface DeferredVerifyOptions {
	concurrency?: number;
}

export async function runDeferredVerification(
	items: readonly DeferredVerification[],
	store: HitStore,
	options: DeferredVerifyOptions = {},
): Promise<VerdictUpdate[]> {
	if (items.length === 0 || !store.applyVerdicts) {
		return [];
	}
	const updates: VerdictUpdate[] = [];
	const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
	let cursor = 0;
	const worker = async (): Promise<void> => {
		while (cursor < items.length) {
			const item = items[cursor++];
			const verdict = await verifyByReverseDns(item.ip, item.provider).catch(
				() => null,
			);
			if (!verdict || verdict.method === null) {
				continue;
			}
			updates.push({
				id: item.id,
				date: item.date,
				agent: item.agent,
				verified: verdict.verified,
				verifyMethod: verdict.method,
				verifyState: verdict.state,
			});
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, items.length) }, worker),
	);
	if (updates.length > 0) {
		await store.applyVerdicts(updates);
	}
	return updates;
}
