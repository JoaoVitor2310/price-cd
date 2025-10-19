import { worthyByPopularity } from "@/helpers/worthy-by-popularity";
import { validateFoundGames } from "@/schemas/game.schema";
import { searchSteamCharts } from "@/services/search-steam-charts";
import type { GameAnalysisResult, SearchGamesRequest } from "@/types/games";
import { searchAllKeyShop } from "./search-allkeyshop";

export const searchGamesService = async (
	req: SearchGamesRequest,
): Promise<GameAnalysisResult> => {
	const startTime = performance.now();
	const { minPopularity, gameNames } = req;
	const foundGames = validateFoundGames(await searchSteamCharts(gameNames));

	const worthyGames = worthyByPopularity(foundGames, minPopularity);

	const gamesWithPrices = await searchAllKeyShop(worthyGames);
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
};
