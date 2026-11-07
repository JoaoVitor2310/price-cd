import { describe, expect, it } from "vitest";
import { parseSteamTradesTopicUrl } from "@/domain/lists/topic-url.js";

describe("parseSteamTradesTopicUrl", () => {
	it("reads the code from a topic link with a slug", () => {
		expect(
			parseSteamTradesTopicUrl(
				"https://www.steamtrades.com/trade/wGVYD/h-gog-keys-w-any-offer",
			),
		).toEqual({
			url: "https://www.steamtrades.com/trade/wGVYD/h-gog-keys-w-any-offer",
			code: "wGVYD",
		});
	});

	it.each([
		"https://www.steamtrades.com/trade/wGVYD",
		"https://www.steamtrades.com/trade/wGVYD/",
	])("accepts a link without a slug: %s", (url) => {
		expect(parseSteamTradesTopicUrl(url)?.code).toBe("wGVYD");
	});

	it("drops the query and the fragment", () => {
		expect(
			parseSteamTradesTopicUrl(
				"https://www.steamtrades.com/trade/wGVYD/slug?page=2#comments",
			)?.url,
		).toBe("https://www.steamtrades.com/trade/wGVYD/slug");
	});

	it.each([
		["not a URL", "wGVYD"],
		["http", "http://www.steamtrades.com/trade/wGVYD/slug"],
		["another host", "https://evil.io/trade/wGVYD/slug"],
		["host without www", "https://steamtrades.com/trade/wGVYD/slug"],
		["host as a prefix", "https://www.steamtrades.com.evil.io/trade/wGVYD"],
		["host as the user", "https://www.steamtrades.com@evil.io/trade/wGVYD"],
		["credentials", "https://user:pass@www.steamtrades.com/trade/wGVYD"],
		["another port", "https://www.steamtrades.com:8443/trade/wGVYD"],
		["the search page", "https://www.steamtrades.com/trades/search?user=1"],
		["no code", "https://www.steamtrades.com/trade/"],
		["extra path", "https://www.steamtrades.com/trade/wGVYD/slug/more"],
		["path traversal", "https://www.steamtrades.com/trade/abc/../../user/1"],
		["encoded traversal", "https://www.steamtrades.com/trade/%2e%2e/user"],
	])("refuses %s", (_case, url) => {
		expect(parseSteamTradesTopicUrl(url)).toBeNull();
	});
});
