import { describe, it, expect } from "vitest";
import { MIN_PRICE_EURO, partitionByPrice } from "@/domain/games/worthy-by-price.js";

const makeGames = (prices: (number | undefined)[]) =>
	prices.map((GamivoPrice, i) => ({ id: i, name: `Game ${i}`, popularity: 100, GamivoPrice }));

describe("partitionByPrice", () => {
	it("keeps only games above the minimum price as worthy", () => {
		const { worthy } = partitionByPrice(makeGames([0.1, 0.51, 3]));
		expect(worthy.map((g) => g.GamivoPrice)).toEqual([0.51, 3]);
	});

	it("reports the discarded games instead of dropping them silently", () => {
		const { tooCheap } = partitionByPrice(makeGames([0.1, 0.51, 3]));
		expect(tooCheap.map((g) => g.GamivoPrice)).toEqual([0.1]);
	});

	it("treats the game exactly at the threshold as too cheap", () => {
		const { worthy, tooCheap } = partitionByPrice(makeGames([MIN_PRICE_EURO]));
		expect(worthy).toHaveLength(0);
		expect(tooCheap).toHaveLength(1);
	});

	it("puts games without a price on the discarded side", () => {
		const { worthy, tooCheap } = partitionByPrice(makeGames([undefined, 2]));
		expect(worthy.map((g) => g.GamivoPrice)).toEqual([2]);
		expect(tooCheap.map((g) => g.GamivoPrice)).toEqual([undefined]);
	});

	it("returns both sides empty for empty input", () => {
		expect(partitionByPrice([])).toEqual({ worthy: [], tooCheap: [] });
	});

	it("uses a custom price floor when one is provided", () => {
		const { worthy, tooCheap } = partitionByPrice(makeGames([0.1, 1, 2]), 1);
		expect(worthy.map((g) => g.GamivoPrice)).toEqual([2]);
		expect(tooCheap.map((g) => g.GamivoPrice)).toEqual([0.1, 1]);
	});

	it("with a zero floor keeps any priced game but still discards the priceless", () => {
		const { worthy, tooCheap } = partitionByPrice(makeGames([0.01, 0, undefined]), 0);
		expect(worthy.map((g) => g.GamivoPrice)).toEqual([0.01]);
		expect(tooCheap.map((g) => g.GamivoPrice)).toEqual([0, undefined]);
	});

	it("defaults to MIN_PRICE_EURO when no floor is given", () => {
		const prices = [0.49, MIN_PRICE_EURO, 0.51];
		expect(partitionByPrice(makeGames(prices))).toEqual(
			partitionByPrice(makeGames(prices), MIN_PRICE_EURO),
		);
	});

	it("preserves generic type — extra fields are kept", () => {
		const { worthy } = partitionByPrice([
			{ id: 0, name: "Game A", popularity: 200, region: "EU", GamivoPrice: 4.5 },
		]);
		expect(worthy[0].region).toBe("EU");
	});

	it("does not mutate the original array", () => {
		const games = makeGames([0.1, 0.51, 3]);
		const original = [...games];
		partitionByPrice(games);
		expect(games).toEqual(original);
	});

	it("accounts for every input game across both sides", () => {
		const games = makeGames([0.1, 0.5, 0.51, undefined, 9]);
		const { worthy, tooCheap } = partitionByPrice(games);
		expect(worthy.length + tooCheap.length).toBe(games.length);
	});
});
