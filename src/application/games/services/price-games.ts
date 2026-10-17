import type { FoundGames } from "@/application/games/game.types.js";
import { logDiscardedByPopularityTier } from "@/application/games/services/log-discarded-by-popularity.js";
import { logDiscardedByPrice } from "@/application/games/services/log-discarded-by-price.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";
import {
	lowestTier,
	needsPopularityLookup,
	partitionByPopularityTier,
	type SearchCriteria,
} from "@/domain/games/search-criteria.js";
import { partitionByPrice } from "@/domain/games/worthy-by-price.js";

export type PriceGamesInput = {
	gameNames: string[];
	criteria: SearchCriteria;
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
	/**
	 * Sobreviveu ao corte de popularidade feito ANTES do preço (o menor tier) e à
	 * lista de exclusão. É o que foi mandado ao AllKeyShop.
	 */
	worthyByPopularity: FoundGames[];
	/** Tem preço acima do piso e passou no tier exato do seu preço — o resultado útil. */
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

	/**
	 * Os tiers de popularidade dependem do preço, que só se conhece depois do
	 * AllKeyShop. Filtrar tudo no fim faria o AllKeyShop pesquisar quase todo jogo;
	 * por isso o corte é feito em dois estágios:
	 *
	 * 1. antes do preço, pelo MENOR tier — quem não passa nele não passa em nenhum;
	 * 2. depois do preço, pelo tier exato daquela faixa.
	 */
	async run(input: PriceGamesInput): Promise<PriceGamesResult> {
		const { criteria } = input;
		const { popularity: tiers } = criteria;
		const requested = [...new Set(input.gameNames)];

		if (requested.length === 0) {
			return { requested, found: [], worthyByPopularity: [], priced: [] };
		}

		// Com um tier em 0 e o outro acima, o menor tier é 0 mas a consulta continua
		// necessária: quem decide consultar é `needsPopularityLookup`, não o mínimo.
		const minimum = lowestTier(tiers);
		const found = await this.popularityFetcher.fetch(
			requested,
			needsPopularityLookup(tiers),
		);
		const worthy = filterExcludedGames(worthyByPopularity(found, minimum));

		// Não vale abrir o browser do AllKeyShop para lista vazia.
		if (worthy.length === 0) {
			return { requested, found, worthyByPopularity: worthy, priced: [] };
		}

		const withPrices = await this.priceFetcher.fetch(
			worthy,
			criteria.checkGamivoOffer,
		);
		const { worthy: aboveFloor, tooCheap } = partitionByPrice(
			withPrices,
			criteria.minPrice,
		);
		logDiscardedByPrice(tooCheap, criteria.minPrice);

		const { worthy: priced, tooUnpopular } = partitionByPopularityTier(
			aboveFloor,
			tiers,
		);
		logDiscardedByPopularityTier(tooUnpopular, tiers);

		return { requested, found, worthyByPopularity: worthy, priced };
	}
}
