import type { PopularityFetcher, PriceFetcher } from "@/application/games/ports/game-search.ports.js";
import { validateFoundGames } from "@/schemas/game.schema.js";
import type { GameAnalysisResult } from "@/types/games.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";

export type SearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
	popularityFetcher: PopularityFetcher;
	priceFetcher: PriceFetcher;
};

export class SearchGamesUseCase {
	async execute(input: SearchGamesInput): Promise<GameAnalysisResult> {
		const startTime = performance.now();
		const { minPopularity, checkGamivoOffer, popularityFetcher, priceFetcher } = input;
		const gameNames = [...new Set(input.gameNames)];

		if (gameNames.length === 0) {
			const processingTime = (performance.now() - startTime) / 1000;
			return {
				games: [],
				summary: {
					totalRequested: 0,
					foundGames: 0,
					worthyByPopularity: 0,
					foundPrices: 0,
					processingTimeSeconds: processingTime,
				},
			};
		}

		const foundGames = validateFoundGames(
			await popularityFetcher.fetch(gameNames, minPopularity),
		);

		const worthyGames = worthyByPopularity(foundGames, minPopularity);

		const gamesWithPrices =
			worthyGames.length === 0
				? []
				: await priceFetcher.fetch(worthyGames, checkGamivoOffer);

		const processingTime = (performance.now() - startTime) / 1000;
		console.log(`🕒 [INFO] Processing time: ${processingTime} seconds.`);

		return {
			games: gamesWithPrices,
			summary: {
				totalRequested: gameNames.length,
				foundGames: foundGames.length,
				worthyByPopularity: worthyGames.length,
				foundPrices: gamesWithPrices.length,
				processingTimeSeconds: processingTime,
			},
		};
	}
}
