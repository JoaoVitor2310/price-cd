import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { SearchGamesUseCase } from "@/application/games/use-cases/search-games.use-case.js";


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

		const result = await new SearchGamesUseCase(
			new PriceGames(makePopularityFetcher(found), makePriceFetcher(priced)),
		).execute({
			gameNames: ["Cheap", "Threshold", "Worthy"],
			minPopularity: 100,
			checkGamivoOffer: false,
		});

		expect(result.games.map((g) => g.name)).toEqual(["Worthy"]);
	});

	it("counts only worthy prices in foundPrices", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.99)];

		const result = await new SearchGamesUseCase(
			new PriceGames(makePopularityFetcher(found), makePriceFetcher(priced)),
		).execute({
			gameNames: ["Cheap", "Worthy"],
			minPopularity: 100,
			checkGamivoOffer: false,
		});

		expect(result.summary.foundPrices).toBe(1);
		expect(result.summary.worthyByPopularity).toBe(2);
	});

	it("returns an empty list when every price is too low", async () => {
		const result = await new SearchGamesUseCase(
			new PriceGames(
				makePopularityFetcher([game("Cheap")]),
				makePriceFetcher([game("Cheap", 0.1)]),
			),
		).execute({
			gameNames: ["Cheap"],
			minPopularity: 100,
			checkGamivoOffer: false,
		});

		expect(result.games).toEqual([]);
		expect(result.summary.foundPrices).toBe(0);
	});
});
