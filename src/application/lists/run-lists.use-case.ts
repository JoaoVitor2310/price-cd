import type {
	GameSearcher,
	ListTopicFetcher,
} from "@/application/lists/ports/list-run.ports.js";
import type { GameTradeImporter, GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import { disposeIfPresent } from "@/lib/dispose.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

const MIN_POPULARITY = 30;

export type RunListsInput = {
	supplierListRequest: SupplierListRequest;
	fetcher: ListTopicFetcher;
	checkGamivoOffer: boolean;
	gameSearcher: GameSearcher;
	tradeImporter: GameTradeImporter;
};

/**
 * Use case: orquestrates domain + ports.
 * 1) Get user lists from Steam Trades.
 * 2) For each list reference, search HTML and classify active/inactive.
 * 3) Inactive → skip. Active → accumulate games from all lists.
 * 4) Call popularity + price pipeline.
 * 5) Push priced games directly to the inventory system via tradeImporter.
 */
export class RunListsUseCase {
	async execute(input: RunListsInput): Promise<void> {
		const { supplierListRequest, fetcher, checkGamivoOffer, gameSearcher, tradeImporter } = input;
		const steam_id = supplierListRequest.steam_id;

		const allGameNames: string[] = [];

		const maxActiveLists = Number(process.env.MAX_ACTIVE_LISTS) || 3;

		try {
			const userLists = await fetcher.fetchUserLists(steam_id);
			const limitedLists = userLists.slice(0, Math.max(1, maxActiveLists));

			for (const userList of limitedLists) {
				const list = await fetcher.fetchList(userList.url);

				if (list.status === "inactive") continue;

				allGameNames.push(...list.gameNames);
			}
		} finally {
			await disposeIfPresent(fetcher);
		}

		const analysis = await gameSearcher.search({
			minPopularity: MIN_POPULARITY,
			gameNames: allGameNames,
			checkGamivoOffer,
		});

		const pricedGames: GameTradeInput[] = analysis.games
			.filter((g) => g.GamivoPrice != null)
			.map((g) => ({
				name: g.name,
				price_euro: g.GamivoPrice as number,
				popularity: g.popularity,
				region: g.region ?? null,
				id_steam: g.id_steam ?? null,
				gamivo_id: g.gamivo_id ?? null,
			}));

		if (pricedGames.length > 0) {
			await tradeImporter.import(pricedGames, { supplier_steam_id: steam_id });
		}
	}
}
