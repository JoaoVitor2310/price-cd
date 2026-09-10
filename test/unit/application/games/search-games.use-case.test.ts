import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";

const game = (name: string, GamivoPrice?: number): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	region: "global",
	GamivoPrice,
});

const makePopularityFetcher = (games: FoundGames[]): PopularityFetcher => ({
	fetch: vi.fn().mockResolvedValue(games),
});

const makePriceFetcher = (games: FoundGames[]): PriceFetcher => ({
	fetch: vi.fn().mockResolvedValue(games),
});

describe("SearchGamesUseCase", () => {
	it("drops games priced at or below the minimum price", async () => {
		const found = [game("Cheap"), game("Threshold"), game("Worthy")];
		const priced = [
			game("Cheap", 0.2),
			game("Threshold", 0.5),
			game("Worthy", 1.99),
		];

		const result = await new SearchGamesUseCase().execute({
			gameNames: ["Cheap", "Threshold", "Worthy"],
			minPopularity: 100,
			checkGamivoOffer: false,
			popularityFetcher: makePopularityFetcher(found),
			priceFetcher: makePriceFetcher(priced),
		});

		expect(result.games.map((g) => g.name)).toEqual(["Worthy"]);
	});

	it("counts only worthy prices in foundPrices", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.99)];

		const result = await new SearchGamesUseCase().execute({
			gameNames: ["Cheap", "Worthy"],
			minPopularity: 100,
			checkGamivoOffer: false,
			popularityFetcher: makePopularityFetcher(found),
			priceFetcher: makePriceFetcher(priced),
		});

		expect(result.summary.foundPrices).toBe(1);
		expect(result.summary.worthyByPopularity).toBe(2);
	});

	it("returns an empty list when every price is too low", async () => {
		const result = await new SearchGamesUseCase().execute({
			gameNames: ["Cheap"],
			minPopularity: 100,
			checkGamivoOffer: false,
			popularityFetcher: makePopularityFetcher([game("Cheap")]),
			priceFetcher: makePriceFetcher([game("Cheap", 0.1)]),
		});

		expect(result.games).toEqual([]);
		expect(result.summary.foundPrices).toBe(0);
	});
});
