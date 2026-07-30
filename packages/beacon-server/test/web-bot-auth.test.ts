import assert from "node:assert/strict";
import {
	sign as cryptoSign,
	generateKeyPairSync,
	type JsonWebKey,
	type KeyObject,
} from "node:crypto";
import { afterEach, describe, it } from "node:test";
import {
	__clearDirectoryCacheForTest,
	__jwkThumbprintForTest,
	__setDirectoryForTest,
	verifyWebBotAuth,
} from "../src/web-bot-auth.js";

const HOST = "zerobooks.app";

const SIGNATURE_AGENT = '"https://agent.bot.goog"';

function makeKeyPair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey;
	const keyid = __jwkThumbprintForTest(jwk);
	if (!keyid) {
		throw new Error("Ed25519 JWK must produce a thumbprint");
	}
	return { jwk, keyid, privateKey };
}

function sign(
	privateKey: KeyObject,
	components: [string, string][],
	paramsText: string,
) {
	const componentList = components.map(([name]) => name).join(" ");
	const base = [
		...components.map(([name, value]) => `${name}: ${value}`),
		`"@signature-params": (${componentList})${paramsText}`,
	].join("\n");
	const signature = cryptoSign(null, Buffer.from(base, "utf8"), privateKey);
	return {
		signature: `sig1=:${signature.toString("base64")}:`,
		signatureInput: `sig1=(${componentList})${paramsText}`,
	};
}

function params(keyid: string, over: Record<string, string | number> = {}) {
	const created = Math.floor(Date.parse("2026-07-25T18:00:00Z") / 1000);
	const values: Record<string, string | number> = {
		created,
		expires: created + 300,
		...over,
	};
	return (
		`;created=${values.created};expires=${values.expires}` +
		`;keyid="${keyid}";alg="ed25519";tag="web-bot-auth"`
	);
}

const OCCURRED_AT = new Date("2026-07-25T18:01:00Z");
describe("verifyWebBotAuth", () => {
	afterEach(() => {
		__clearDirectoryCacheForTest();
	});
	it("accepts a signature over the minimal component set", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[
				['"@authority"', HOST],
				['"signature-agent"', SIGNATURE_AGENT],
			],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/terms.md",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "signed");
		assert.equal(result.signatureAgent, "agent.bot.goog");
	});
	it("accepts a signature covering method, path and query", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[
				['"@method"', "GET"],
				['"@authority"', HOST],
				['"@path"', "/terms.md"],
				['"@query"', "?v=2"],
				['"@scheme"', "https"],
				['"@target-uri"', `https://${HOST}/terms.md?v=2`],
			],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/terms.md?v=2",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "signed");
	});
	it("uses `?` for an empty query, per RFC 9421", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[
				['"@authority"', HOST],
				['"@query"', "?"],
			],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/terms.md",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "signed");
	});
	it("rejects a signature over a different authority", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[['"@authority"', "someone-else.example"]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/terms.md",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "invalid_signature");
	});
	it("rejects a key that did not sign the request", async () => {
		const signer = makeKeyPair();
		const impostor = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [impostor.jwk]);
		const paramsText = params(impostor.keyid);
		const { signature, signatureInput } = sign(
			signer.privateKey,
			[['"@authority"', HOST]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "invalid_signature");
	});
	it("rejects a signature that had already expired when the request happened", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const created = Math.floor(Date.parse("2026-07-25T12:00:00Z") / 1000);
		const paramsText = params(keyid, { created, expires: created + 60 });
		const { signature, signatureInput } = sign(
			privateKey,
			[['"@authority"', HOST]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "invalid_signature");
	});
	it("tolerates the batching delay between the request and ingest", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[['"@authority"', HOST]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: new Date("2026-07-25T18:04:30Z"),
		});
		assert.equal(result.outcome, "signed");
	});
	it("reports an uncheckable component set as unsupported, not a forgery", async () => {
		const { jwk, keyid, privateKey } = makeKeyPair();
		__setDirectoryForTest(SIGNATURE_AGENT, [jwk]);
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[
				['"@authority"', HOST],
				['"content-digest"', "sha-256=:abc:"],
			],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "unsupported");
	});
	it("refuses a non-https Signature-Agent", async () => {
		const { keyid, privateKey } = makeKeyPair();
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[['"@authority"', HOST]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: '"http://agent.bot.goog"',
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "unsupported");
		assert.equal(result.signatureAgent, null);
	});
	it("reports an unreachable directory as unavailable", async () => {
		const { keyid, privateKey } = makeKeyPair();
		const agent = '"https://directory.invalid"';
		const paramsText = params(keyid);
		const { signature, signatureInput } = sign(
			privateKey,
			[['"@authority"', HOST]],
			paramsText,
		);
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature,
			signatureInput,
			signatureAgent: agent,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "unavailable");
	});
	it("rejects a garbled Signature-Input without throwing", async () => {
		const result = await verifyWebBotAuth({
			host: HOST,
			method: "GET",
			rawPath: "/",
			signature: "sig1=:not-base64!:",
			signatureInput: "this is not a structured field",
			signatureAgent: SIGNATURE_AGENT,
			occurredAt: OCCURRED_AT,
		});
		assert.equal(result.outcome, "unsupported");
	});
});
