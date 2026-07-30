export type AICrawlerCategory =
	| "answer_fetch"
	| "search_index"
	| "training"
	| "ai_crawler";

export interface AICrawlerEntry {
	token: string;
	agent: string;
	provider: string;
	category: AICrawlerCategory;
}

export interface AICrawlerMatch {
	provider: string;
	agent: string;
	category: AICrawlerCategory;
}

export const AI_CRAWLERS: readonly AICrawlerEntry[] = [
	{
		token: "chatgpt-user",
		agent: "ChatGPT-User",
		provider: "OpenAI",
		category: "answer_fetch",
	},
	{
		token: "oai-searchbot",
		agent: "OAI-SearchBot",
		provider: "OpenAI",
		category: "search_index",
	},
	{
		token: "oai-adsbot",
		agent: "OAI-AdsBot",
		provider: "OpenAI",
		category: "ai_crawler",
	},
	{
		token: "gptbot",
		agent: "GPTBot",
		provider: "OpenAI",
		category: "training",
	},
	{
		token: "claude-user",
		agent: "Claude-User",
		provider: "Anthropic",
		category: "answer_fetch",
	},
	{
		token: "claude-searchbot",
		agent: "Claude-SearchBot",
		provider: "Anthropic",
		category: "search_index",
	},
	{
		token: "claudebot",
		agent: "ClaudeBot",
		provider: "Anthropic",
		category: "training",
	},
	{
		token: "anthropic-ai",
		agent: "anthropic-ai",
		provider: "Anthropic",
		category: "training",
	},
	{
		token: "perplexity-user",
		agent: "Perplexity-User",
		provider: "Perplexity",
		category: "answer_fetch",
	},
	{
		token: "perplexitybot",
		agent: "PerplexityBot",
		provider: "Perplexity",
		category: "search_index",
	},
	{
		token: "gemini-deep-research",
		agent: "Gemini-Deep-Research",
		provider: "Google",
		category: "answer_fetch",
	},
	{
		token: "google-gemininotebook",
		agent: "Google-GeminiNotebook",
		provider: "Google",
		category: "answer_fetch",
	},
	{
		token: "google-notebooklm",
		agent: "Google-NotebookLM",
		provider: "Google",
		category: "answer_fetch",
	},
	{
		token: "google-read-aloud",
		agent: "Google-Read-Aloud",
		provider: "Google",
		category: "answer_fetch",
	},
	{
		token: "google-agent",
		agent: "Google-Agent",
		provider: "Google",
		category: "answer_fetch",
	},
	{
		token: "google-cloudvertexbot",
		agent: "Google-CloudVertexBot",
		provider: "Google",
		category: "training",
	},
	{
		token: "google-extended",
		agent: "Google-Extended",
		provider: "Google",
		category: "training",
	},
	{
		token: "googleother",
		agent: "GoogleOther",
		provider: "Google",
		category: "ai_crawler",
	},
	{
		token: "copilot",
		agent: "Copilot",
		provider: "Microsoft",
		category: "answer_fetch",
	},
	{
		token: "grok-deepsearch",
		agent: "Grok-DeepSearch",
		provider: "xAI",
		category: "answer_fetch",
	},
	{
		token: "xai-searchbot",
		agent: "xAI-SearchBot",
		provider: "xAI",
		category: "search_index",
	},
	{
		token: "xai-web-crawler",
		agent: "xAI-Web-Crawler",
		provider: "xAI",
		category: "ai_crawler",
	},
	{
		token: "grokbot",
		agent: "GrokBot",
		provider: "xAI",
		category: "ai_crawler",
	},
	{
		token: "xai-bot",
		agent: "xAI-Bot",
		provider: "xAI",
		category: "ai_crawler",
	},
	{
		token: "mistralai-user",
		agent: "MistralAI-User",
		provider: "Mistral",
		category: "answer_fetch",
	},
	{
		token: "mistralai-index",
		agent: "MistralAI-Index",
		provider: "Mistral",
		category: "search_index",
	},
	{
		token: "applebot",
		agent: "Applebot",
		provider: "Apple",
		category: "search_index",
	},
	{
		token: "applebot-extended",
		agent: "Applebot-Extended",
		provider: "Apple",
		category: "training",
	},
	{
		token: "amzn-user",
		agent: "Amzn-User",
		provider: "Amazon",
		category: "answer_fetch",
	},
	{
		token: "amzn-searchbot",
		agent: "Amzn-SearchBot",
		provider: "Amazon",
		category: "search_index",
	},
	{
		token: "amazonbot",
		agent: "Amazonbot",
		provider: "Amazon",
		category: "training",
	},
	{
		token: "meta-externalfetcher",
		agent: "Meta-ExternalFetcher",
		provider: "Meta",
		category: "answer_fetch",
	},
	{
		token: "meta-externalagent",
		agent: "Meta-ExternalAgent",
		provider: "Meta",
		category: "training",
	},
	{
		token: "meta-webindexer",
		agent: "Meta-WebIndexer",
		provider: "Meta",
		category: "search_index",
	},
	{
		token: "duckassistbot",
		agent: "DuckAssistBot",
		provider: "DuckDuckGo",
		category: "answer_fetch",
	},
	{
		token: "kimi-user",
		agent: "Kimi-User",
		provider: "Moonshot AI",
		category: "answer_fetch",
	},
	{
		token: "kimi-searchbot",
		agent: "Kimi-SearchBot",
		provider: "Moonshot AI",
		category: "search_index",
	},
	{
		token: "kimibot",
		agent: "KimiBot",
		provider: "Moonshot AI",
		category: "ai_crawler",
	},
	{
		token: "qwen-user",
		agent: "Qwen-User",
		provider: "Alibaba",
		category: "answer_fetch",
	},
	{
		token: "qwenbot",
		agent: "QwenBot",
		provider: "Alibaba",
		category: "ai_crawler",
	},
	{
		token: "tongyibot",
		agent: "TongyiBot",
		provider: "Alibaba",
		category: "ai_crawler",
	},
	{
		token: "aliyunbot",
		agent: "AliyunBot",
		provider: "Alibaba",
		category: "ai_crawler",
	},
	{
		token: "doubaobot",
		agent: "Doubaobot",
		provider: "ByteDance",
		category: "ai_crawler",
	},
	{
		token: "bytespider",
		agent: "Bytespider",
		provider: "ByteDance",
		category: "training",
	},
	{
		token: "tiktokspider",
		agent: "TikTokSpider",
		provider: "ByteDance",
		category: "search_index",
	},
	{
		token: "erniebot",
		agent: "ERNIEBot",
		provider: "Baidu",
		category: "ai_crawler",
	},
	{
		token: "yiyanbot",
		agent: "YiyanBot",
		provider: "Baidu",
		category: "ai_crawler",
	},
	{
		token: "deepseekbot",
		agent: "DeepSeekBot",
		provider: "DeepSeek",
		category: "ai_crawler",
	},
	{
		token: "chatglm-spider",
		agent: "ChatGLM-Spider",
		provider: "Zhipu AI",
		category: "ai_crawler",
	},
	{
		token: "cohere-training-data-crawler",
		agent: "cohere-training-data-crawler",
		provider: "Cohere",
		category: "training",
	},
	{
		token: "cohere-ai",
		agent: "cohere-ai",
		provider: "Cohere",
		category: "training",
	},
	{
		token: "ai2bot",
		agent: "AI2Bot",
		provider: "Allen AI",
		category: "training",
	},
	{
		token: "youbot",
		agent: "YouBot",
		provider: "You.com",
		category: "ai_crawler",
	},
	{
		token: "ccbot",
		agent: "CCBot",
		provider: "Common Crawl",
		category: "training",
	},
] as const;

const CRAWLERS_BY_SPECIFICITY: readonly AICrawlerEntry[] = [
	...AI_CRAWLERS,
].sort((a, b) => b.token.length - a.token.length);

export function classifyAICrawler(
	userAgent: string | null | undefined,
): AICrawlerMatch | null {
	if (!userAgent) {
		return null;
	}
	const ua = userAgent.toLowerCase();
	for (const entry of CRAWLERS_BY_SPECIFICITY) {
		if (ua.includes(entry.token)) {
			return {
				provider: entry.provider,
				agent: entry.agent,
				category: entry.category,
			};
		}
	}
	return null;
}

export function listAICrawlerProviders(): string[] {
	return [...new Set(AI_CRAWLERS.map((c) => c.provider))].sort();
}
