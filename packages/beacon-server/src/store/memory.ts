import type {
	DailyRollup,
	HitStore,
	StoredHit,
	VerdictUpdate,
} from "./types.js";

export class MemoryHitStore implements HitStore {
	readonly hits: StoredHit[] = [];
	readonly rollups = new Map<string, DailyRollup>();
	save(
		hits: readonly StoredHit[],
		rollups: readonly DailyRollup[],
	): Promise<void> {
		this.hits.push(...hits);
		for (const entry of rollups) {
			const key = `${entry.date}|${entry.agent}`;
			const existing = this.rollups.get(key);
			if (!existing) {
				this.rollups.set(key, { ...entry });
				continue;
			}
			existing.hits += entry.hits;
			existing.markdownHits += entry.markdownHits;
			existing.htmlHits += entry.htmlHits;
			existing.verifiedHits += entry.verifiedHits;
		}
		return Promise.resolve();
	}
	applyVerdicts(updates: readonly VerdictUpdate[]): Promise<void> {
		for (const update of updates) {
			const hit = this.hits.find((h) => h.id === update.id);
			if (!hit) {
				continue;
			}
			const becameVerified = update.verified && !hit.verified;
			hit.verified = update.verified;
			hit.verifyMethod = update.verifyMethod;
			hit.verifyState = update.verifyState;
			const rollup = this.rollups.get(`${update.date}|${update.agent}`);
			if (rollup && becameVerified) {
				rollup.verifiedHits += 1;
			}
		}
		return Promise.resolve();
	}
}
