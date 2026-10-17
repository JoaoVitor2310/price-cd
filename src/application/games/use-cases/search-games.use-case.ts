import type { GameAnalysisResult } from "@/application/games/game.types.js";
import type { PriceGames } from "@/application/games/services/price-games.js";
import { flatPopularity } from "@/domain/games/search-criteria.js";
import { MIN_PRICE_EURO } from "@/domain/games/worthy-by-price.js";

/** Só dado: as dependências estão no construtor. */
export type SearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
};

/**
 * O caso de uso do endpoint `POST /api/games/search`, e **só** dele.
 *
 * Tudo que era motor de precificação saiu para `PriceGames`, compartilhado com
 * `ResearchGamesUseCase`, `lists` e `suppliers`. O que sobrou aqui é o que
 * existe por causa da resposta HTTP: as contagens do resumo e a medição de
 * tempo. Nenhum outro consumidor usa isso — `lists` e `suppliers` liam só
 * `.games` e descartavam o resto.
 *
 * Sai na etapa 3 de `docs/SEARCH_PRESETS.md`, quando a sync de bundle do Sistema
 * Estoque migrar para `/api/games/research`. Até lá mantém o comportamento de
 * sempre: popularidade plana e o piso padrão de preço.
 *
 * Sem `@Injectable()`: `application/` nunca importa `@nestjs/*`.
 */
export class SearchGamesUseCase {
	constructor(private readonly priceGames: PriceGames) {}

	async execute(input: SearchGamesInput): Promise<GameAnalysisResult> {
		const startTime = performance.now();

		const { requested, found, worthyByPopularity, priced } =
			await this.priceGames.run({
				gameNames: input.gameNames,
				criteria: {
					popularity: flatPopularity(input.minPopularity),
					minPrice: MIN_PRICE_EURO,
					checkGamivoOffer: input.checkGamivoOffer,
				},
			});

		const processingTimeSeconds = (performance.now() - startTime) / 1000;

		// Lista vazia não gera log de tempo: não houve trabalho a medir.
		if (requested.length > 0) {
			console.log(`🕒 [INFO] Processing time: ${processingTimeSeconds} seconds.`);
		}

		return {
			games: priced,
			summary: {
				totalRequested: requested.length,
				foundGames: found.length,
				worthyByPopularity: worthyByPopularity.length,
				foundPrices: priced.length,
				processingTimeSeconds,
			},
		};
	}
}
