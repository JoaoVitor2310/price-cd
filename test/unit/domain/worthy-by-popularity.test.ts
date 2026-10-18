import { describe, it, expect } from "vitest";
import {
	withUnratedGames,
	worthyByPopularity,
} from "@/domain/games/worthy-by-popularity.js";

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
			{ id: 0, name: "Game A", popularity: 200, region: "global", GamivoPrice: 4.5 },
		];
		const result = worthyByPopularity(games, 100);
		expect(result[0].region).toBe("global");
		expect(result[0].GamivoPrice).toBe(4.5);
	});

	it("does not mutate the original array", () => {
		const games = makeGames([10, 50, 200]);
		const original = [...games];
		worthyByPopularity(games, 100);
		expect(games).toEqual(original);
	});
});

const rated = (name: string, popularity: number) => ({
	id: 0,
	name,
	popularity,
});

describe("withUnratedGames", () => {
	it("gives a game SteamCharts did not return popularity 0, keeping the requested order", () => {
		const result = withUnratedGames(
			["Half-Life", "Obscure Indie", "Portal 2"],
			[rated("Portal 2", 900), rated("Half-Life", 50)],
		);

		expect(result.map((game) => game.name)).toEqual([
			"Half-Life",
			"Obscure Indie",
			"Portal 2",
		]);
		expect(result.find((game) => game.name === "Obscure Indie")).toEqual({
			id: 1,
			name: "Obscure Indie",
			popularity: 0,
		});
	});

	it("leaves a rated game untouched, including its extra fields", () => {
		const half = { id: 7, name: "Half-Life", popularity: 50, id_steam: "70" };

		expect(withUnratedGames(["Half-Life"], [half])[0]).toBe(half);
	});

	it("is a no-op when every game was returned", () => {
		const found = [rated("A", 1), rated("B", 2)];

		expect(withUnratedGames(["A", "B"], found)).toEqual(found);
	});

	it("returns everything as unrated when nothing was found", () => {
		const result = withUnratedGames(["A", "B"], []);

		expect(result.map((game) => game.popularity)).toEqual([0, 0]);
	});
});

describe("unrated games against a popularity minimum", () => {
	const all = withUnratedGames(["Known", "Unknown"], [rated("Known", 40)]);

	it("keeps the unknown game when the minimum is 0", () => {
		expect(worthyByPopularity(all, 0).map((game) => game.name)).toEqual([
			"Known",
			"Unknown",
		]);
	});

	it("drops the unknown game once the minimum is 1 or more", () => {
		expect(worthyByPopularity(all, 1).map((game) => game.name)).toEqual([
			"Known",
		]);
	});
});
