import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	AI_CRAWLERS,
	classifyAICrawler,
	listAICrawlerProviders,
} from "../src/crawlers.js";

const CHROME =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
describe("classifyAICrawler", () => {
	it("returns null for ordinary browser traffic", () => {
		assert.equal(classifyAICrawler(CHROME), null);
	});
	it("returns null for empty input", () => {
		assert.equal(classifyAICrawler(""), null);
		assert.equal(classifyAICrawler(null), null);
		assert.equal(classifyAICrawler(undefined), null);
	});
	it("identifies user-triggered fetches as answer_fetch", () => {
		const match = classifyAICrawler(
			"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
		);
		assert.deepEqual(match, {
			provider: "OpenAI",
			agent: "ChatGPT-User",
			category: "answer_fetch",
		});
	});
	it("identifies training crawlers", () => {
		assert.equal(
			classifyAICrawler(
				"Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)",
			)?.category,
			"training",
		);
		assert.equal(
			classifyAICrawler("CCBot/2.0 (https://commoncrawl.org/faq/)")?.category,
			"training",
		);
	});
	it("prefers the most specific token when one contains another", () => {
		assert.deepEqual(classifyAICrawler("ClaudeBot/1.0"), {
			provider: "Anthropic",
			agent: "ClaudeBot",
			category: "training",
		});
		assert.deepEqual(classifyAICrawler("Claude-SearchBot/1.0"), {
			provider: "Anthropic",
			agent: "Claude-SearchBot",
			category: "search_index",
		});
		assert.deepEqual(classifyAICrawler("Claude-User/1.0"), {
			provider: "Anthropic",
			agent: "Claude-User",
			category: "answer_fetch",
		});
		assert.equal(
			classifyAICrawler("Mozilla/5.0 (compatible; Applebot-Extended/0.1)")
				?.agent,
			"Applebot-Extended",
		);
	});
	it("does not match on vendor names alone", () => {
		assert.equal(classifyAICrawler("my-claude-scraper/1.0"), null);
		assert.equal(classifyAICrawler("openai-python/1.2.0"), null);
		assert.equal(classifyAICrawler(`${CHROME} grok-extension`), null);
	});
	it("excludes classic search engines by design", () => {
		assert.equal(
			classifyAICrawler("Googlebot/2.1 (+http://www.google.com/bot.html)"),
			null,
		);
		assert.equal(
			classifyAICrawler("Mozilla/5.0 (compatible; bingbot/2.0)"),
			null,
		);
	});
	it("classifies GoogleOther without catching Googlebot", () => {
		assert.deepEqual(classifyAICrawler("GoogleOther/1.0"), {
			provider: "Google",
			agent: "GoogleOther",
			category: "ai_crawler",
		});
		assert.equal(
			classifyAICrawler(
				"Googlebot-Image/1.0 (+http://www.google.com/bot.html)",
			),
			null,
		);
	});
	it("classifies newer Google and Meta AI surfaces", () => {
		assert.equal(
			classifyAICrawler("Mozilla/5.0 (compatible; Google-Agent/1.0)")?.category,
			"answer_fetch",
		);
		assert.equal(
			classifyAICrawler("Mozilla/5.0 (compatible; Google-Read-Aloud)")
				?.category,
			"answer_fetch",
		);
		assert.equal(
			classifyAICrawler("Google-GeminiNotebook")?.agent,
			"Google-GeminiNotebook",
		);
		assert.deepEqual(
			classifyAICrawler(
				"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Gemini-Deep-Research; +https://gemini.google/overview/deep-research/) Chrome/135.0.0.0 Safari/537.36",
			),
			{
				provider: "Google",
				agent: "Gemini-Deep-Research",
				category: "answer_fetch",
			},
		);
		assert.deepEqual(classifyAICrawler("meta-webindexer/1.1"), {
			provider: "Meta",
			agent: "Meta-WebIndexer",
			category: "search_index",
		});
	});
	it("is case insensitive", () => {
		assert.equal(
			classifyAICrawler("PERPLEXITYBOT/1.0")?.agent,
			"PerplexityBot",
		);
	});
});
describe("AI_CRAWLERS registry", () => {
	it("has no duplicate tokens", () => {
		const tokens = AI_CRAWLERS.map((c) => c.token);
		assert.equal(new Set(tokens).size, tokens.length);
	});
	it("stores every token lowercased, so matching cannot silently miss", () => {
		for (const entry of AI_CRAWLERS) {
			assert.equal(entry.token, entry.token.toLowerCase(), entry.agent);
		}
	});
	it("matches its own canonical agent string for every entry", () => {
		for (const entry of AI_CRAWLERS) {
			const match = classifyAICrawler(`${entry.agent}/1.0`);
			assert.ok(match, `${entry.agent} did not match itself`);
			assert.equal(
				match.agent,
				entry.agent,
				`${entry.agent} matched ${match.agent}`,
			);
		}
	});
	it("lists providers", () => {
		const providers = listAICrawlerProviders();
		assert.ok(providers.includes("OpenAI"));
		assert.ok(providers.includes("Anthropic"));
		assert.deepEqual(providers, [...providers].sort());
	});
});
