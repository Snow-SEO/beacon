export {
	createFetchMiddleware,
	type FetchMiddlewareContext,
} from "./adapters/fetch.js";

export {
	type AnalyticsConfig,
	BeaconAnalytics,
	type BeaconHit,
	DEFAULT_INGEST_ENDPOINT,
	INGEST_PATH,
	normalizeIngestEndpoint,
	type WaitUntilContext,
} from "./analytics.js";

export {
	Beacon,
	type BeaconConfig,
	createBeacon,
	type HandleContext,
	type MarkdownResolver,
	type ResolvedMarkdown,
} from "./beacon.js";

export {
	type ConvertOptions,
	decodeEntities,
	extractMetadata,
	htmlToMarkdown,
} from "./convert.js";

export {
	AI_CRAWLERS,
	type AICrawlerCategory,
	type AICrawlerEntry,
	type AICrawlerMatch,
	classifyAICrawler,
	listAICrawlerProviders,
} from "./crawlers.js";

export { createDirResolver, type DirResolverOptions } from "./dir-resolver.js";

export {
	createFetchResolver,
	type FetchResolverOptions,
	isTwinFetch,
	TWIN_FETCH_HEADER,
} from "./fetch-resolver.js";

export {
	type GeneratedTwin,
	type GenerateOptions,
	type GenerateResult,
	generateTwins,
	routeForHtmlFile,
	type SkippedPage,
	type SkipReason,
} from "./generate.js";

export {
	appendLink,
	BEACON_SPEC_VERSION,
	buildMarkdownHeaders,
	DEFAULT_CONTENT_SIGNAL,
	injectAlternateLink,
	MARKDOWN_CONTENT_TYPE,
	type MarkdownResponseOptions,
	markdownResponse,
	mergeVary,
	notAcceptableResponse,
} from "./headers.js";

export {
	type LlmsTxtLink,
	type LlmsTxtOptions,
	type LlmsTxtSection,
	renderLlmsFullTxt,
	renderLlmsTxt,
} from "./llms-txt.js";

export {
	negotiateFormat,
	type ParsedMediaType,
	parseAcceptHeader,
	type Representation,
} from "./negotiate.js";

export {
	fromMarkdownPath,
	isMarkdownPath,
	toCanonicalUrl,
	toMarkdownPath,
	toMarkdownUrl,
} from "./paths.js";

export {
	buildMdSitemap,
	buildSitemapIndex,
	chunkSitemapEntries,
	escapeXml,
	MAX_URLS_PER_SITEMAP,
	robotsSitemapDirective,
	type SitemapEntry,
	type SitemapIndexEntry,
} from "./sitemap.js";

export {
	estimateTokens,
	resetTokenEstimator,
	setTokenEstimator,
	type TokenEstimator,
} from "./tokens.js";
