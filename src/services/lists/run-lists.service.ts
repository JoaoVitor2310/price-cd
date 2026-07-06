import type { SupplierListRequest } from "@/schemas/list.schema.js";
import { RunListsUseCase } from "@/application/lists/run-lists.use-case.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";

const runListsUseCase = new RunListsUseCase();
const searchGamesUseCase = new SearchGamesUseCase();
const popularityFetcher = new SteamChartsPopularityFetcher();
const priceFetcher = new AllKeyShopPriceFetcher();

function getTradeImporter(): HttpGameTradeImporter {
	const baseUrl = process.env.SISTEMA_ESTOQUE_URL;
	const token = process.env.EXTERNAL_SECRET;
	if (!baseUrl || !token) {
		throw new Error("SISTEMA_ESTOQUE_URL and EXTERNAL_SECRET must be set for lists flow");
	}
	return new HttpGameTradeImporter(baseUrl, token);
}

class GameSearcherAdapter implements GameSearcher {
	async search(request: SearchGamesRequest): Promise<GameAnalysisResult> {
		return searchGamesUseCase.execute({
			...request,
			popularityFetcher,
			priceFetcher,
		});
	}
}

const gameSearcher = new GameSearcherAdapter();

export const runListsService = async (supplierListRequest: SupplierListRequest): Promise<void> => {
	await runListsUseCase.execute({
		supplierListRequest,
		fetcher: fetchListTopic(),
		checkGamivoOffer: supplierListRequest.checkGamivoOffer,
		gameSearcher,
		tradeImporter: getTradeImporter(),
	});
};
