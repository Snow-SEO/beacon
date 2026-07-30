import type { VerifyMethod, VerifyState } from "../ip-verify.js";

export interface StoredHit {
	id: string;
	occurredAt: Date;
	provider: string;
	agent: string;
	category: string;
	host: string;
	path: string;
	format: "markdown" | "html" | null;
	statusCode: number | null;
	referrer: string | null;
	ip: string | null;
	userAgent: string;
	verified: boolean;
	verifyMethod: VerifyMethod | null;
	verifyState: VerifyState;
}

export interface DailyRollup {
	date: string;
	agent: string;
	provider: string;
	category: string;
	hits: number;
	markdownHits: number;
	htmlHits: number;
	verifiedHits: number;
}

export interface VerdictUpdate {
	id: string;
	date: string;
	agent: string;
	verified: boolean;
	verifyMethod: VerifyMethod | null;
	verifyState: VerifyState;
}

export interface HitStore {
	init?(): Promise<void>;
	save(
		hits: readonly StoredHit[],
		rollups: readonly DailyRollup[],
	): Promise<void>;
	applyVerdicts?(updates: readonly VerdictUpdate[]): Promise<void>;
	close?(): Promise<void>;
}
