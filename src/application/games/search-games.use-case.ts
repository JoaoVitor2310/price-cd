import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import type { FoundGames, GameAnalysisResult } from "@/application/games/game.types.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";
import { partitionByPrice } from "@/domain/games/worthy-by-price.js";
import { logDiscardedByPrice } from "@/application/games/log-discarded-by-price.js";

/**
 * Só **dado**. As dependências saíram daqui e foram para o construtor — antes
 * as duas coisas viajavam no mesmo objeto, e o chamador tinha que saber montar
 * a infraestrutura para pedir uma busca.
 */
export type SearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
};

/**
 * Sem `@Injectable()` de propósito: `application/` nunca importa `@nestjs/*`
 * (CLAUDE.md, ADR 0004). O container registra esta classe com `useFactory` +
 * `inject`, que dispensa o decorator — ver `src/nest/games/games.module.ts`.
 */
export class SearchGamesUseCase {
	constructor(
		private readonly popularityFetcher: PopularityFetcher,
		private readonly priceFetcher: PriceFetcher,
	) {}

	async execute(input: SearchGamesInput): Promise<GameAnalysisResult> {
		const startTime = performance.now();
		const { minPopularity, checkGamivoOffer } = input;
		const { popularityFetcher, priceFetcher } = this;
		const gameNames = [...new Set(input.gameNames)];

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

		const foundGames: FoundGames[] = await popularityFetcher.fetch(gameNames, minPopularity);

		const worthyGames = filterExcludedGames(worthyByPopularity(foundGames, minPopularity));

		const priced =
			worthyGames.length === 0
				? []
				: await priceFetcher.fetch(worthyGames, checkGamivoOffer);

		const { worthy: gamesWithPrices, tooCheap } = partitionByPrice(priced);
		logDiscardedByPrice(tooCheap);

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
	}
}
