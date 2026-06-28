import { describe, it, expect } from "vitest";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";

const game = (name: string) => ({ name, popularity: 100 });

describe("filterExcludedGames", () => {
	it("removes games present in the exclusion list", () => {
		const result = filterExcludedGames([game("Smite 2"), game("Half-Life")]);
		expect(result.map((g) => g.name)).toEqual(["Half-Life"]);
	});

	it("is case-insensitive when matching", () => {
		const result = filterExcludedGames([game("SMITE 2"), game("smite 2"), game("Smite 2")]);
		expect(result).toHaveLength(0);
	});

	it("preserves games not in the exclusion list", () => {
		const result = filterExcludedGames([game("Half-Life"), game("Portal")]);
		expect(result).toHaveLength(2);
	});

	it("returns an empty array when all games are excluded", () => {
		expect(filterExcludedGames([game("Smite 2")])).toEqual([]);
	});

	it("returns an empty array when input is empty", () => {
		expect(filterExcludedGames([])).toEqual([]);
	});

	it("preserves all original fields of non-excluded games", () => {
		const input = [{ name: "Half-Life", popularity: 500, region: "global" }];
		expect(filterExcludedGames(input)).toEqual(input);
	});
});
