import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
	__clearDatacenterRangesForTest,
	__setDatacenterRangesForTest,
	hasLoadedDatacenterRanges,
	isDatacenterIp,
} from "../src/datacenter-ranges.js";

const HUAWEI_HK = "27.106.96.0/20";
describe("isDatacenterIp", () => {
	afterEach(() => {
		__clearDatacenterRangesForTest();
	});
	it("matches an address inside a hosting range", () => {
		__setDatacenterRangesForTest([HUAWEI_HK]);
		assert.equal(isDatacenterIp("27.106.106.73"), true);
	});
	it("does not match an address outside every range", () => {
		__setDatacenterRangesForTest([HUAWEI_HK]);
		assert.equal(isDatacenterIp("203.0.113.9"), false);
	});
	it("matches IPv6 hosting ranges", () => {
		__setDatacenterRangesForTest(["2600:1f18::/32"]);
		assert.equal(isDatacenterIp("2600:1f18:aa::5"), true);
		assert.equal(isDatacenterIp("2001:db8::1"), false);
	});
	it("matches through a prefix shorter than /8", () => {
		__setDatacenterRangesForTest(["8.0.0.0/7"]);
		assert.equal(isDatacenterIp("9.1.2.3"), true);
	});
	it("answers false on a cold index rather than guessing", () => {
		assert.equal(hasLoadedDatacenterRanges(), false);
		assert.equal(isDatacenterIp("27.106.106.73"), false);
	});
	it("ignores malformed and absent addresses", () => {
		__setDatacenterRangesForTest([HUAWEI_HK]);
		assert.equal(isDatacenterIp(undefined), false);
		assert.equal(isDatacenterIp(""), false);
		assert.equal(isDatacenterIp("not-an-ip"), false);
		assert.equal(isDatacenterIp("27.106.106.999"), false);
	});
	it("returns a consistent answer once memoised", () => {
		__setDatacenterRangesForTest([HUAWEI_HK]);
		assert.equal(isDatacenterIp("27.106.106.73"), true);
		assert.equal(isDatacenterIp("27.106.106.73"), true);
		__setDatacenterRangesForTest(["198.51.100.0/24"]);
		assert.equal(isDatacenterIp("27.106.106.73"), false);
	});
});
