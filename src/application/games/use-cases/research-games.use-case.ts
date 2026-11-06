import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { PriceGames } from "@/application/games/services/price-games.js";
import { priceResearchGames } from "@/application/games/services/price-research-games.js";

const DEMO_GAME_LIMIT = 10;

/**
 * Como devolver os jogos — decisão do chamador, independente dos critérios:
 *
 * - `respond`: todos os jogos. Existe para a sync de bundle do Sistema Estoque,
 *   que guarda os preços no próprio bundle.
 * - `demo`: limitado a `DEMO_GAME_LIMIT` jogos — é o que roda sem token.
 *
 * O pedido que cria Trade não passa por aqui: é o `CreateResearchTrade`,
 * executado pela fila.
 */
export type ResearchDelivery = "respond" | "demo";

export type ResearchGamesInput = ResearchGamesRequest & {
	delivery: ResearchDelivery;
};

/** Pesquisa e devolve os jogos na resposta, sem criar nada. */
export class ResearchGamesUseCase {
	constructor(private readonly priceGames: PriceGames) {}

	async execute(input: ResearchGamesInput): Promise<GameTradeInput[]> {
		// O limite é do modo demo, não do motor: `respond` processa a lista inteira.
		const limit = input.delivery === "demo" ? DEMO_GAME_LIMIT : undefined;
		const { games } = await priceResearchGames(this.priceGames, input, limit);
		return games;
	}
}
