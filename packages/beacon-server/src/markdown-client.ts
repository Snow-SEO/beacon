import { isIP } from "node:net";
import { findProviderOwningIp } from "./crawler-ranges.js";
import type { VerifyVerdict } from "./ip-verify.js";

export const MARKDOWN_CLIENT_CATEGORY = "markdown_client";

const UNIDENTIFIED_PROVIDER = "Unidentified";

const UNIDENTIFIED_AGENT = "Unidentified client";

const AUTOMATED_BROWSER_AGENT = "Automated browser";

const MAX_AGENT_LENGTH = 32;

const PRODUCT_TOKEN = /^([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)(?:[/\s]|$)/i;

export interface MarkdownClientHit {
	provider: string;
	agent: string;
	category: string;
	verdict: VerifyVerdict;
}

function agentFromUserAgent(userAgent: string): string {
	const token = PRODUCT_TOKEN.exec(userAgent.trim())?.[1];
	if (!token) {
		return UNIDENTIFIED_AGENT;
	}
	return token.slice(0, MAX_AGENT_LENGTH);
}

export function classifyMarkdownClient(
	userAgent: string,
	ip: string | undefined,
	options: {
		automatedBrowser?: boolean;
	} = {},
): MarkdownClientHit {
	const owner = ip && isIP(ip) !== 0 ? findProviderOwningIp(ip) : null;
	return {
		provider: owner ?? UNIDENTIFIED_PROVIDER,
		agent: options.automatedBrowser
			? AUTOMATED_BROWSER_AGENT
			: agentFromUserAgent(userAgent),
		category: MARKDOWN_CLIENT_CATEGORY,
		verdict: owner
			? { verified: true, state: "verified", method: "cidr" }
			: { verified: false, state: "unverified", method: null },
	};
}
