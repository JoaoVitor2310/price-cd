import type { FoundGames } from "@/application/games/game.types.js";
import { logDiscardedByPrice } from "@/application/games/services/log-discarded-by-price.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";
import { partitionByPrice } from "@/domain/games/worthy-by-price.js";

export type PriceGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
	/** Piso de preço negociável. Omitido → default do domínio (`MIN_PRICE_EURO`). */
	minPrice?: number;
};

/**
 * O que o pipeline produziu, em cada estágio.
 *
 * Os estágios intermediários são expostos porque quem chama decide o que fazer
 * com eles — `/api/games/search` monta um resumo com as contagens, `lists` e
 * `suppliers` só querem `priced`. Devolver o resumo pronto era justamente o
 * problema: forçava dois consumidores a receber uma forma que existe para a
 * resposta HTTP de um terceiro.
 */
export type PriceGamesResult = {
	/** Nomes efetivamente pesquisados, já sem duplicatas. */
	requested: string[];
	/** Tudo que o SteamCharts encontrou. */
	found: FoundGames[];
	/** Sobreviveu à popularidade mínima e à lista de exclusão. */
	worthyByPopularity: FoundGames[];
	/** Tem preço e está acima do piso — o resultado útil. */
	priced: FoundGames[];
};

/**
 * O motor de precificação: nomes de jogos → jogos com preço que valem a pena.
 *
 * Extraído de `SearchGamesUseCase`, que acumulava dois papéis — o caso de uso do
 * endpoint `/api/games/search` **e** o motor compartilhado por `lists` e
 * `suppliers`. Toda política colocada nele era herdada pelos três, quisessem ou
 * não; foi o que aconteceu com o piso de preço.
 *
 * Não é `*.service.ts` de propósito: essa convenção está proibida neste repo
 * (`docs/nest-conceitos.md` §9) porque colide com o vocabulário do Nest e com o
 * `src/services/` legado. É um colaborador de `application/`, compartilhado
 * entre use cases.
 *
 * Sem `@Injectable()`: `application/` nunca importa `@nestjs/*`.
 */
export class PriceGames {
	constructor(
		private readonly popularityFetcher: PopularityFetcher,
		private readonly priceFetcher: PriceFetcher,
	) {}

	async run(input: PriceGamesInput): Promise<PriceGamesResult> {
		const requested = [...new Set(input.gameNames)];

		if (requested.length === 0) {
			return { requested, found: [], worthyByPopularity: [], priced: [] };
		}

		const found = await this.popularityFetcher.fetch(
			requested,
			input.minPopularity,
		);
		const worthy = filterExcludedGames(
			worthyByPopularity(found, input.minPopularity),
		);

		// Não vale abrir o browser do AllKeyShop para lista vazia.
		if (worthy.length === 0) {
			return { requested, found, worthyByPopularity: worthy, priced: [] };
		}

		const withPrices = await this.priceFetcher.fetch(
			worthy,
			input.checkGamivoOffer,
		);
		const { worthy: priced, tooCheap } = partitionByPrice(
			withPrices,
			input.minPrice,
		);
		logDiscardedByPrice(tooCheap, input.minPrice);

		return { requested, found, worthyByPopularity: worthy, priced };
	}
}
