const CHARS_PER_TOKEN = 4;

export type TokenEstimator = (text: string) => number;

let estimator: TokenEstimator = (text) =>
	Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));

export function estimateTokens(text: string): number {
	if (!text) {
		return 0;
	}
	return estimator(text);
}

export function setTokenEstimator(fn: TokenEstimator): void {
	estimator = fn;
}

export function resetTokenEstimator(): void {
	estimator = (text) => Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}
