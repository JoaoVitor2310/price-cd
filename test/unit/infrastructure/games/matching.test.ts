import { describe, it, expect } from "vitest";
import { matchSearchResult } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import type { SearchResult } from "@/infrastructure/games/allkeyshop-html-parser.js";

const makeSearchResult = (name: string, overrides: Partial<SearchResult> = {}): SearchResult => ({
	link: "/game/some-link",
	name,
	price: "4,99",
	...overrides,
});

describe("matchSearchResult", () => {
	it("returns null when there are no search results", () => {
		expect(matchSearchResult("House Flipper", [])).toBeNull();
	});

	it("matches a result with the exact same normalized name", () => {
		const results = [makeSearchResult("House Flipper", { link: "/game/house-flipper" })];
		const result = matchSearchResult("House Flipper", results);
		expect(result).toEqual({ link: "/game/house-flipper", name: "House Flipper" });
	});

	it("matches ignoring case and surrounding whitespace", () => {
		const results = [makeSearchResult("house flipper")];
		const result = matchSearchResult("  House Flipper  ", results);
		expect(result).not.toBeNull();
	});

	it("returns null when no result matches the normalized name", () => {
		const results = [makeSearchResult("Some Other Game")];
		expect(matchSearchResult("House Flipper", results)).toBeNull();
	});

	it("skips a result whose edition does not match the query (asymmetric edition mismatch)", () => {
		const results = [makeSearchResult("House Flipper Deluxe Edition")];
		expect(matchSearchResult("House Flipper", results)).toBeNull();
	});

	it("matches when both the query and the result share the same edition keyword", () => {
		const results = [makeSearchResult("House Flipper Deluxe Edition", { link: "/game/house-flipper-deluxe" })];
		const result = matchSearchResult("House Flipper Deluxe Edition", results);
		expect(result).toEqual({ link: "/game/house-flipper-deluxe", name: "House Flipper Deluxe Edition" });
	});

	it("matches an edition query against a listing that omits the bare 'Edition' word", () => {
		// A key "Deluxe Edition" e uma listada como só "Deluxe" são a MESMA edição.
		const results = [makeSearchResult("House Flipper Deluxe", { link: "/game/house-flipper-deluxe" })];
		const result = matchSearchResult("House Flipper Deluxe Edition", results);
		expect(result?.link).toBe("/game/house-flipper-deluxe");
	});

	it("matches across different GOTY spellings (same edition)", () => {
		const results = [makeSearchResult("House Flipper GOTY", { link: "/game/house-flipper-goty" })];
		const result = matchSearchResult("House Flipper Game of the Year Edition", results);
		expect(result?.link).toBe("/game/house-flipper-goty");
	});

	it("still skips when the tier differs (Deluxe query vs Standard listing)", () => {
		const results = [makeSearchResult("House Flipper Standard Edition")];
		expect(matchSearchResult("House Flipper Deluxe Edition", results)).toBeNull();
	});

	it("matches a base query against a 'Standard Edition' listing (standard = base)", () => {
		const results = [makeSearchResult("House Flipper Standard Edition", { link: "/game/house-flipper" })];
		const result = matchSearchResult("House Flipper", results);
		expect(result?.link).toBe("/game/house-flipper");
	});

	it("returns the first matching result and ignores the rest", () => {
		const results = [
			makeSearchResult("Other Game"),
			makeSearchResult("House Flipper", { link: "/game/first-match" }),
			makeSearchResult("House Flipper", { link: "/game/second-match" }),
		];
		const result = matchSearchResult("House Flipper", results);
		expect(result?.link).toBe("/game/first-match");
	});
});
