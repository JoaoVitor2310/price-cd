import { describe, it, expect } from "vitest";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";

const makeGames = (popularities: number[]) =>
	popularities.map((popularity, i) => ({ id: i, name: `Game ${i}`, popularity }));

describe("worthyByPopularity", () => {
	it("returns all games when minPopularity is 0", () => {
		const games = makeGames([0, 5, 100]);
		expect(worthyByPopularity(games, 0)).toHaveLength(3);
	});

	it("filters games below the minimum popularity", () => {
		const games = makeGames([10, 50, 200]);
		const result = worthyByPopularity(games, 100);
		expect(result).toHaveLength(1);
		expect(result[0].popularity).toBe(200);
	});

	it("includes game exactly at the minimum threshold", () => {
		const games = makeGames([99, 100, 101]);
		const result = worthyByPopularity(games, 100);
		expect(result).toHaveLength(2);
		expect(result.map((g) => g.popularity)).toEqual([100, 101]);
	});

	it("returns empty array when no game reaches the minimum", () => {
		const games = makeGames([1, 5, 30]);
		expect(worthyByPopularity(games, 1000)).toHaveLength(0);
	});

	it("returns empty array for empty input", () => {
		expect(worthyByPopularity([], 50)).toHaveLength(0);
	});

	it("preserves generic type — extra fields are kept", () => {
		const games = [
			{ id: 0, name: "Game A", popularity: 200, region: "global", GamivoPrice: "4,50" },
		];
		const result = worthyByPopularity(games, 100);
		expect(result[0].region).toBe("global");
		expect(result[0].GamivoPrice).toBe("4,50");
	});

	it("does not mutate the original array", () => {
		const games = makeGames([10, 50, 200]);
		const original = [...games];
		worthyByPopularity(games, 100);
		expect(games).toEqual(original);
	});
});
