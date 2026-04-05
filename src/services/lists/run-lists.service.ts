import type { VipListRequest } from "@/schemas/list.schema.js";
import { RunListsUseCase } from "@/application/lists/run-lists.use-case.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { formatList } from "@/infrastructure/lists/format-list-result.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";

export type RunListsServiceResult = {
	status: "completed" | "failed";
	result: string;
};

const runListsUseCase = new RunListsUseCase();
const searchGamesUseCase = new SearchGamesUseCase();
const popularityFetcher = new SteamChartsPopularityFetcher();
const priceFetcher = new AllKeyShopPriceFetcher();

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

/**
 * Camada de "aplicação" exposta ao Express: compõe portas
 * e delega ao caso de uso.
 */
export const runListsService = async (
	vipListRequest: VipListRequest,
): Promise<RunListsServiceResult> => {
	const listResult = await runListsUseCase.execute({
		vipListRequest,
		fetcher: fetchListTopic(),
		checkGamivoOffer: vipListRequest.checkGamivoOffer,
		formatter: formatList(),
		gameSearcher,
	});

	return {
		status: listResult.status,
		result: listResult.result,
	};
};
