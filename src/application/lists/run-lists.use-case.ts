import type {
	ListResultFormatter,
	ListTopicFetcher,
} from "@/application/lists/ports/list-run.ports.js";
import { disposeIfPresent } from "@/lib/dispose.js";
import type { VipListRequest } from "@/schemas/list.schema.js";
import { searchGamesService } from "@/services/game-search.service.js";

const MIN_POPULARITY = 30;

export type RunListsInput = {
	vipListRequest: VipListRequest;
	fetcher: ListTopicFetcher;
	checkGamivoOffer: boolean;
	formatter: ListResultFormatter;
};

export type RunListsOutput = {
	status: "completed" | "failed";
	result: string;
};

/**
 * Use case: orquestrates domain + ports.
 * 1) Get user lists from Steam Trades.
 * 2) For each list reference, search HTML and classify active/inactive.
 * 3) Inactive → accumulate list references.
 * 4) Active → accumulate games from all lists.
 * 5) Concatenate and call the price flow with fixed minPopularity.
 * 6) Return the list result formatted.
 */
export class RunListsUseCase {
	async execute(input: RunListsInput): Promise<RunListsOutput> {
		const { vipListRequest, fetcher, checkGamivoOffer, formatter } = input;
		const idSteam = vipListRequest.id_steam;

		const allGameNames: string[] = [];

		const maxActiveLists = Number(process.env.MAX_ACTIVE_LISTS) || 3;

		try {
			const userLists = await fetcher.fetchUserLists(idSteam);
			const limitedLists = userLists.slice(0, Math.max(1, maxActiveLists));

			for (const userList of limitedLists) {
				const list = await fetcher.fetchList(userList.url);

				if (list.status === "inactive") continue;

				allGameNames.push(...list.gameNames);
			}
		} finally {
			await disposeIfPresent(fetcher);
		}

		const analysis = await searchGamesService({
			minPopularity: MIN_POPULARITY,
			gameNames: allGameNames,
			checkGamivoOffer,
		});

		const listResult = formatter.formatListResult(analysis, idSteam);

		return {
			status: "completed",
			result: listResult,
		};
	}
}
