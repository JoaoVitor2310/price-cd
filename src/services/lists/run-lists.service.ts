import type { SupplierListRequest } from "@/schemas/list.schema.js";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";
import type { FoundGames, SearchGamesRequest } from "@/application/games/game.types.js";

const runListsUseCase = new RunListsUseCase();
// `lists` consome o motor direto: nunca usou o `summary` do endpoint.
const priceGames = new PriceGames(
	new SteamChartsPopularityFetcher(),
	new AllKeyShopPriceFetcher(),
);

function getTradeImporter(): HttpGameTradeImporter {
	const baseUrl = process.env.SISTEMA_ESTOQUE_URL;
	const token = process.env.EXTERNAL_SECRET;
	if (!baseUrl || !token) {
		throw new Error("SISTEMA_ESTOQUE_URL and EXTERNAL_SECRET must be set for lists flow");
	}
	return new HttpGameTradeImporter(baseUrl, token);
}

class GameSearcherAdapter implements GameSearcher {
	async search(request: SearchGamesRequest): Promise<FoundGames[]> {
		return (await priceGames.run(request)).priced;
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
