import { describe, expect, it } from "vitest";
import {
	DEFAULT_POPULARITY_TIERS,
	flatPopularity,
	lowestTier,
	needsPopularityLookup,
	partitionByPopularityTier,
	requiredPopularity,
	tierFor,
} from "@/domain/games/search-criteria.js";

const tiers = { upToThreshold: 10, aboveThreshold: 100, priceThresholdEuro: 5 };

describe("requiredPopularity", () => {
	it.each([
		[0.51, 10],
		[4.99, 10],
		[5, 10], // fronteira inclusiva: €5,00 ainda é "até €5"
		[5.01, 100],
		[60, 100],
	])("a game priced €%s needs %i", (price, expected) => {
		expect(requiredPopularity(tiers, price)).toBe(expected);
	});

	it("follows an edited threshold", () => {
		expect(requiredPopularity({ ...tiers, priceThresholdEuro: 2 }, 3)).toBe(100);
	});
});

describe("tierFor", () => {
	it("names the side the price falls on, with its minimum", () => {
		expect(tierFor(tiers, 5)).toEqual({ side: "upToThreshold", minimum: 10 });
		expect(tierFor(tiers, 5.01)).toEqual({ side: "aboveThreshold", minimum: 100 });
	});

	it("is what requiredPopularity answers with, so the two never disagree", () => {
		for (const price of [0, 4.99, 5, 5.01, 80]) {
			expect(requiredPopularity(tiers, price)).toBe(tierFor(tiers, price).minimum);
		}
	});
});

describe("lowestTier", () => {
	it("is the smaller of the two tiers, whichever side it is on", () => {
		expect(lowestTier(tiers)).toBe(10);
		expect(lowestTier({ ...tiers, upToThreshold: 200 })).toBe(100);
	});
});

describe("needsPopularityLookup", () => {
	it("is the number a tier needs to compare against: false only when both tiers are 0", () => {
		expect(needsPopularityLookup(flatPopularity(0))).toBe(false);
		expect(needsPopularityLookup({ ...tiers, upToThreshold: 0 })).toBe(true);
		expect(needsPopularityLookup(flatPopularity(1))).toBe(true);
	});
});

describe("partitionByPopularityTier", () => {
	it("keeps games that meet the minimum of their own price tier and reports the rest", () => {
		const games = [
			{ name: "cheap ok", popularity: 10, GamivoPrice: 3 },
			{ name: "cheap low", popularity: 9, GamivoPrice: 3 },
			{ name: "pricey ok", popularity: 100, GamivoPrice: 8 },
			{ name: "pricey low", popularity: 99, GamivoPrice: 8 },
		];

		const { worthy, tooUnpopular } = partitionByPopularityTier(games, tiers);

		expect(worthy.map((g) => g.name)).toEqual(["cheap ok", "pricey ok"]);
		expect(tooUnpopular.map((g) => g.name)).toEqual(["cheap low", "pricey low"]);
	});

	it("lets everything through when both tiers are 0", () => {
		const games = [{ popularity: 0, GamivoPrice: 30 }];

		expect(partitionByPopularityTier(games, flatPopularity(0)).worthy).toHaveLength(1);
	});
});

describe("defaults", () => {
	it("are 30 up to €5 (the old flat cut) and 100 above", () => {
		expect(DEFAULT_POPULARITY_TIERS).toEqual({
			upToThreshold: 30,
			aboveThreshold: 100,
			priceThresholdEuro: 5,
		});
	});

	it("cannot be mutated by a caller", () => {
		expect(Object.isFrozen(DEFAULT_POPULARITY_TIERS)).toBe(true);
	});
});
