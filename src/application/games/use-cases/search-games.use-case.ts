import type { GameAnalysisResult } from "@/application/games/game.types.js";
import type { PriceGames } from "@/application/games/services/price-games.js";

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
 * Sem `@Injectable()`: `application/` nunca importa `@nestjs/*`.
 */
export class SearchGamesUseCase {
	constructor(private readonly priceGames: PriceGames) {}

	async execute(input: SearchGamesInput): Promise<GameAnalysisResult> {
		const startTime = performance.now();

		const { requested, found, worthyByPopularity, priced } =
			await this.priceGames.run(input);

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
