import { randomUUID } from "node:crypto";
import { classifyAICrawler } from "@snowseo/beacon";
import { findProviderOwningIp } from "./crawler-ranges.js";
import { isDatacenterIp } from "./datacenter-ranges.js";
import {
	shouldDeferReverseDns,
	type VerifyVerdict,
	verifyCrawlerIpSync,
} from "./ip-verify.js";
import { classifyMarkdownClient } from "./markdown-client.js";
import {
	type IncomingHit,
	isWellFormedHit,
	MAX_PATH_LENGTH,
	MAX_UA_LENGTH,
	parseOccurredAt,
	truncate,
	utcDate,
} from "./protocol.js";
import type { DailyRollup, StoredHit } from "./store/types.js";
import { verifyWebBotAuth } from "./web-bot-auth.js";

const SIGNED_VERDICT: VerifyVerdict = {
	verified: true,
	state: "signed",
	method: "web_bot_auth",
};

const MAX_SAMPLED_DROPPED_AGENTS = 5;

const MAX_SAMPLED_AGENT_LENGTH = 80;

export interface DeferredVerification {
	id: string;
	ip: string;
	provider: string;
	agent: string;
	date: string;
}

export interface IngestOptions {
	transformIp?: (ip: string) => string | null;
	now?: () => number;
}

export interface IngestResult {
	rows: StoredHit[];
	rollups: DailyRollup[];
	deferred: DeferredVerification[];
	accepted: number;
	skipped: number;
	reasons: {
		malformed: number;
		unrecognized: number;
	};
	droppedAgents: string[];
}

function looksLikeRealBrowser(hit: IncomingHit): boolean {
	const headers = hit.headers;
	if (!headers?.["sec-fetch-mode"]) {
		return hit.fromBrowser === true;
	}
	return Boolean(headers["sec-fetch-dest"] && headers["sec-fetch-site"]);
}

export async function ingestBatch(
	host: string,
	hits: readonly IncomingHit[],
	options: IngestOptions = {},
): Promise<IngestResult> {
	const now = options.now ?? Date.now;
	const transformIp = options.transformIp ?? ((ip: string) => ip);
	const signatureResults = await Promise.all(
		hits.map((hit) =>
			hit.signature && hit.signatureInput && isWellFormedHit(hit)
				? verifyWebBotAuth({
						host,
						method: hit.method,
						rawPath: hit.rawPath,
						signature: hit.signature,
						signatureInput: hit.signatureInput,
						signatureAgent: hit.signatureAgent,
						occurredAt: parseOccurredAt(hit.occurredAt, now()),
					}).catch(() => null)
				: Promise.resolve(null),
		),
	);
	const rows: StoredHit[] = [];
	const deferred: DeferredVerification[] = [];
	const rollup = new Map<string, DailyRollup>();
	const droppedAgents = new Set<string>();
	let malformed = 0;
	let unrecognized = 0;
	for (const [i, hit] of hits.entries()) {
		if (!isWellFormedHit(hit)) {
			malformed += 1;
			continue;
		}
		const registered = classifyAICrawler(hit.userAgent);
		const fromBrowser = looksLikeRealBrowser(hit);
		const automatedBrowser =
			fromBrowser &&
			(Boolean(hit.ip && findProviderOwningIp(hit.ip)) ||
				isDatacenterIp(hit.ip));
		const browserVeto = fromBrowser && !automatedBrowser;
		const markdownClient =
			registered || !hit.askedForMarkdown || browserVeto
				? null
				: classifyMarkdownClient(hit.userAgent, hit.ip, { automatedBrowser });
		const match = registered ?? markdownClient;
		if (!match) {
			unrecognized += 1;
			if (droppedAgents.size < MAX_SAMPLED_DROPPED_AGENTS) {
				droppedAgents.add(truncate(hit.userAgent, MAX_SAMPLED_AGENT_LENGTH));
			}
			continue;
		}
		const occurredAt = parseOccurredAt(hit.occurredAt, now());
		const date = utcDate(occurredAt);
		const verdict =
			signatureResults[i]?.outcome === "signed"
				? SIGNED_VERDICT
				: (markdownClient?.verdict ??
					verifyCrawlerIpSync(hit.ip, match.provider));
		const id = randomUUID();
		rows.push({
			id,
			occurredAt,
			provider: match.provider,
			agent: match.agent,
			category: match.category,
			host,
			path: truncate(hit.path, MAX_PATH_LENGTH),
			format: hit.format ?? null,
			statusCode: hit.statusCode ?? null,
			referrer: hit.referrer ?? null,
			ip: hit.ip ? transformIp(hit.ip) : null,
			userAgent: truncate(hit.userAgent, MAX_UA_LENGTH),
			verified: verdict.verified,
			verifyMethod: verdict.method,
			verifyState: verdict.state,
		});
		if (hit.ip && shouldDeferReverseDns(match.provider, verdict.state)) {
			deferred.push({
				id,
				ip: hit.ip,
				provider: match.provider,
				agent: match.agent,
				date,
			});
		}
		const key = `${date}|${match.agent}`;
		const entry = rollup.get(key) ?? {
			date,
			agent: match.agent,
			provider: match.provider,
			category: match.category,
			hits: 0,
			markdownHits: 0,
			htmlHits: 0,
			verifiedHits: 0,
		};
		entry.hits += 1;
		if (verdict.verified) {
			entry.verifiedHits += 1;
		}
		if (hit.format === "markdown") {
			entry.markdownHits += 1;
		} else if (hit.format === "html") {
			entry.htmlHits += 1;
		}
		rollup.set(key, entry);
	}
	return {
		rows,
		rollups: [...rollup.values()],
		deferred,
		accepted: rows.length,
		skipped: hits.length - rows.length,
		reasons: { malformed, unrecognized },
		droppedAgents: [...droppedAgents],
	};
}
