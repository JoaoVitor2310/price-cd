import type { PopularityFetcher, PriceFetcher } from "@/application/games/ports/game-search.ports.js";
import type { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";

export type ResearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
	supplierSteamId?: string;
	listCode?: string;
	popularityFetcher: PopularityFetcher;
	priceFetcher: PriceFetcher;
	tradeImporter: GameTradeImporter;
};

export class ResearchGamesUseCase {
	async execute(input: ResearchGamesInput): Promise<void> {
		const { gameNames, minPopularity, checkGamivoOffer, supplierSteamId, listCode,
			popularityFetcher, priceFetcher, tradeImporter } = input;

		const uniqueNames = [...new Set(gameNames)];
		const foundGames = await popularityFetcher.fetch(uniqueNames, minPopularity);
		const worthyGames = worthyByPopularity(foundGames, minPopularity);

		if (worthyGames.length === 0) return;

		const gamesWithPrices = await priceFetcher.fetch(worthyGames, checkGamivoOffer);

		const pricedGames = gamesWithPrices
			.filter((g) => g.GamivoPrice != null)
			.map((g) => ({
				name: g.name,
				price_euro: g.GamivoPrice as number,
				popularity: g.popularity,
				region: g.region ?? null,
			}));

		if (pricedGames.length === 0) return;

		await tradeImporter.import(pricedGames, {
			supplier_steam_id: supplierSteamId,
			list_code: listCode,
		});
	}
}
