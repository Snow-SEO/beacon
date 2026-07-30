export {
	ipInAnyCidr,
	ipInCidr,
	ipToBigInt,
	type ParsedCidr,
	parseCidr,
	parsedIpInCidr,
} from "./cidr-match.js";

export {
	findProviderOwningIp,
	hasLoadedRanges,
	hasPublishedRanges,
	hasReliableRanges,
	isIpInProviderRanges,
	refreshCrawlerRanges,
	warmCrawlerRangesInBackground,
} from "./crawler-ranges.js";

export {
	hasLoadedDatacenterRanges,
	isDatacenterIp,
	refreshDatacenterRanges,
	warmDatacenterRangesInBackground,
} from "./datacenter-ranges.js";

export { runDeferredVerification } from "./deferred-verify.js";

export {
	type FetchLike,
	resetFetchImplementation,
	setFetchImplementation,
} from "./http.js";

export {
	type DeferredVerification,
	type IngestOptions,
	type IngestResult,
	ingestBatch,
} from "./ingest.js";

export { createIpTransform, type IpMode } from "./ip-privacy.js";

export {
	shouldDeferReverseDns,
	type VerifyMethod,
	type VerifyState,
	type VerifyVerdict,
	verifyByReverseDns,
	verifyCrawlerIpSync,
} from "./ip-verify.js";

export {
	classifyMarkdownClient,
	MARKDOWN_CLIENT_CATEGORY,
	type MarkdownClientHit,
} from "./markdown-client.js";

export {
	BEACON_INGEST_PATH,
	BEACON_KEY_HEADER,
	type BeaconErrorBody,
	type BeaconErrorCode,
	hostMatchesAllowList,
	type IncomingHit,
	type IngestRequestBody,
	type IngestResponseBody,
	isWellFormedHit,
	MAX_HITS_PER_REQUEST,
	MAX_HOST_LENGTH,
	MAX_PATH_LENGTH,
	MAX_UA_LENGTH,
	normalizeHost,
	parseOccurredAt,
	validateIngestBody,
} from "./protocol.js";

export {
	assertResolvedHostIsPublic,
	assertUrlPublic,
	type SafeFetchInit,
	SsrfBlockedError,
	safeFetch,
} from "./safe-fetch.js";

export { MemoryHitStore } from "./store/memory.js";

export {
	PostgresHitStore,
	type PostgresHitStoreOptions,
} from "./store/postgres.js";

export { SqliteHitStore, type SqliteHitStoreOptions } from "./store/sqlite.js";

export type {
	DailyRollup,
	HitStore,
	StoredHit,
	VerdictUpdate,
} from "./store/types.js";

export {
	type SignedRequestFacts,
	verifyWebBotAuth,
	type WebBotAuthOutcome,
	type WebBotAuthResult,
} from "./web-bot-auth.js";
