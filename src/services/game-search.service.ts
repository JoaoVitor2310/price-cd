import { worthyByPopularity } from "@/helpers/worthy-by-popularity";
import { validateFoundGames } from "@/schemas/game.schema";
import { searchGamivo } from "@/services/search-gamivo";
import { searchSteamCharts } from "@/services/search-steam-charts";
import type { foundGames } from "@/types/foundGames";

interface SearchGamesRequest {
	minPopularity: number;
	gameNames: string[];
}

interface GameAnalysisResult {
	games: foundGames[];
	summary: {
		totalRequested: number;
		foundOnSteam: number;
		worthyByPopularity: number;
		foundPrices: number;
		processingTimeMs: number;
	};
}

export const searchGamesService = async (
	req: SearchGamesRequest,
): Promise<GameAnalysisResult> => {
	const startTime = performance.now();
	const { minPopularity, gameNames } = req;
	let foundGames = await searchSteamCharts(gameNames);
	foundGames = validateFoundGames(foundGames);

	const worthyGames = worthyByPopularity(foundGames, minPopularity);

	const gamesWithPrices = await searchGamivo(worthyGames);
	const processingTime = performance.now() - startTime;

	console.log(`🕒 [INFO] Processing time: ${processingTime}ms`);

	return {
		games: gamesWithPrices,
		summary: {
			totalRequested: gameNames.length,
			foundOnSteam: foundGames.length,
			worthyByPopularity: worthyGames.length,
			foundPrices: gamesWithPrices.length,
			processingTimeMs: processingTime,
		},
	};
};
