import type { PopularityFetcher, PriceFetcher } from "@/application/games/ports/game-search.ports.js";
import type { GameTradeImporter, GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";

const DEMO_GAME_LIMIT = 10;

export type ResearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
	supplierSteamId?: string;
	listCode?: string;
	title?: string;
	popularityFetcher: PopularityFetcher;
	priceFetcher: PriceFetcher;
	tradeImporter?: GameTradeImporter;
};

export class ResearchGamesUseCase {
	// Returns null when results were sent to inventory (authenticated).
	// Returns the priced games list when in demo mode.
	async execute(input: ResearchGamesInput): Promise<GameTradeInput[] | null> {
		const { minPopularity, checkGamivoOffer, supplierSteamId, listCode, title,
			popularityFetcher, priceFetcher, tradeImporter } = input;

		const isDemo = !tradeImporter;
		let uniqueNames = [...new Set(input.gameNames)];
		if (isDemo) uniqueNames = uniqueNames.slice(0, DEMO_GAME_LIMIT);

		const foundGames = await popularityFetcher.fetch(uniqueNames, minPopularity);
		const worthyGames = filterExcludedGames(worthyByPopularity(foundGames, minPopularity));

		if (worthyGames.length === 0) return isDemo ? [] : null;

		const gamesWithPrices = await priceFetcher.fetch(worthyGames, checkGamivoOffer);

		const pricedGames: GameTradeInput[] = gamesWithPrices
			.filter((g) => g.GamivoPrice != null)
			.map((g) => ({
				name: g.name,
				price_euro: g.GamivoPrice as number,
				popularity: g.popularity,
				region: g.region ?? null,
			}));

		if (isDemo) return pricedGames;

		if (pricedGames.length > 0) {
			await tradeImporter.import(pricedGames, {
				supplier_steam_id: supplierSteamId,
				list_code: listCode,
				title,
			});
		}

		return null;
	}
}
