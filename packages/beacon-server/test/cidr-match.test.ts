import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ipInAnyCidr,
	ipInCidr,
	ipToBigInt,
	parseCidr,
} from "../src/cidr-match.js";

describe("parseCidr", () => {
	it("parses IPv4 and masks the base to the prefix", () => {
		const c = parseCidr("1.2.3.128/24");
		assert.ok(c);
		assert.equal(c.version, 4);
		assert.equal(c.bits, 24);
		assert.equal(c.base, ipToBigInt("1.2.3.0")?.value);
	});
	it("parses IPv6", () => {
		const c = parseCidr("2600:1f18::/32");
		assert.ok(c);
		assert.equal(c.version, 6);
		assert.equal(c.bits, 32);
	});
	it("rejects malformed input rather than throwing", () => {
		assert.equal(parseCidr("1.2.3.4"), null);
		assert.equal(parseCidr("1.2.3.4/33"), null);
		assert.equal(parseCidr("2600::/129"), null);
		assert.equal(parseCidr("not-an-ip/24"), null);
		assert.equal(parseCidr("999.1.1.1/8"), null);
	});
});
describe("ipInCidr", () => {
	it("matches an IPv4 inside the range and rejects one outside", () => {
		const c = parseCidr("203.0.113.0/24");
		assert.ok(c);
		assert.equal(ipInCidr("203.0.113.42", c), true);
		assert.equal(ipInCidr("203.0.114.42", c), false);
	});
	it("handles /32 exact and /0 catch-all", () => {
		const exact = parseCidr("5.6.7.8/32");
		assert.ok(exact);
		assert.equal(ipInCidr("5.6.7.8", exact), true);
		assert.equal(ipInCidr("5.6.7.9", exact), false);
		const all = parseCidr("0.0.0.0/0");
		assert.ok(all);
		assert.equal(ipInCidr("198.51.100.1", all), true);
	});
	it("matches an IPv6 inside the range and rejects one outside", () => {
		const c = parseCidr("2600:1f18::/32");
		assert.ok(c);
		assert.equal(ipInCidr("2600:1f18:abcd::1", c), true);
		assert.equal(ipInCidr("2601:1f18::1", c), false);
	});
	it("never cross-matches IPv4 against an IPv6 range", () => {
		const v6 = parseCidr("2600:1f18::/32");
		assert.ok(v6);
		assert.equal(ipInCidr("203.0.113.1", v6), false);
		const v4 = parseCidr("203.0.113.0/24");
		assert.ok(v4);
		assert.equal(ipInCidr("2600:1f18::1", v4), false);
	});
});
describe("ipInAnyCidr", () => {
	it("matches when the IP is in one of several ranges", () => {
		const ranges = [parseCidr("1.0.0.0/8"), parseCidr("203.0.113.0/24")].filter(
			(c): c is NonNullable<typeof c> => c !== null,
		);
		assert.equal(ipInAnyCidr("203.0.113.9", ranges), true);
		assert.equal(ipInAnyCidr("8.8.8.8", ranges), false);
	});
});
