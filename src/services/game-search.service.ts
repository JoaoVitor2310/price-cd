import { worthyByPopularity } from "@/helpers/worthy-by-popularity.js";
import { fileContentIdSteamResponseSchema, validateFoundGames, type FileContentIdSteam, type FileContentIdSteamResponse } from "@/schemas/game.schema.js";
import { searchSteamCharts } from "@/services/search-steam-charts.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/types/games.js";
import { searchAllKeyShop } from "./search-allkeyshop.js";

export const searchGamesService = async (
	req: SearchGamesRequest,
): Promise<GameAnalysisResult> => {
	const startTime = performance.now();
	const { minPopularity, gameNames } = req;

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
		await searchSteamCharts(gameNames, minPopularity),
	);

	const worthyGames = worthyByPopularity(foundGames, minPopularity);

	const gamesWithPrices =
		worthyGames.length === 0
			? []
			: await searchAllKeyShop(worthyGames, req.checkGamivoOffer);
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

export const searchGamesIdSteamService = async (
	req: FileContentIdSteam,
): Promise<FileContentIdSteamResponse> => {
	const gameNames = req.games.map((game) => game.name);

	const steamChartsResults = await searchSteamCharts(gameNames, 1);

	const gamesWithSteamId = req.games.map((originalGame) => {
		const steamData = steamChartsResults.find(
			(result) => result.name === originalGame.name,
		);

		return {
			id: originalGame.id,
			name: originalGame.name,
			id_steam: steamData?.id_steam,
		};
	});

	return fileContentIdSteamResponseSchema.parse({
		games: gamesWithSteamId,
	});
};
