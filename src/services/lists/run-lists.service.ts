import { positiveIntFromEnv } from "@/config/env.schema.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import type {
	GameSearcher,
	ListTopicFetcherFactory,
} from "@/application/lists/ports/list-run.ports.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";
import type { FoundGames, SearchGamesRequest } from "@/application/games/game.types.js";

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

/** Uma instância por execução: cada uma é dona de uma sessão de browser. */
const fetcherFactory: ListTopicFetcherFactory = { create: () => fetchListTopic() };

/** Mesma regra do schema: o default não pode ser re-derivado por app. */
function resolveMaxActiveLists(): number {
	return positiveIntFromEnv(process.env.MAX_ACTIVE_LISTS, 3);
}

export const runListsService = async (supplierListRequest: SupplierListRequest): Promise<void> => {
	const runListsUseCase = new RunListsUseCase(
		fetcherFactory,
		new GameSearcherAdapter(),
		getTradeImporter(),
		resolveMaxActiveLists(),
	);

	await runListsUseCase.execute({
		supplierListRequest,
		checkGamivoOffer: supplierListRequest.checkGamivoOffer,
	});
};
