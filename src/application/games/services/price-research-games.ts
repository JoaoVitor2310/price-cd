import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { PriceGames } from "@/application/games/services/price-games.js";

export type ResearchedGames = {
	games: GameTradeInput[];
	/** Nomes que o catálogo não pôde responder. */
	lookupFailed: string[];
};

/**
 * A pesquisa de um pedido: tira os nomes repetidos, roda o motor e põe os jogos
 * que passaram no formato que sai do price-cd. É o que há de comum entre devolver
 * os jogos (`ResearchGamesUseCase`) e criar a Trade (`CreateResearchTrade`).
 *
 * `limit` corta a lista **antes** de pesquisar, para não gastar SteamCharts e
 * AllKeyShop com o que seria descartado.
 */
export const priceResearchGames = async (
	priceGames: PriceGames,
	request: ResearchGamesRequest,
	limit?: number,
): Promise<ResearchedGames> => {
	let gameNames = [...new Set(request.gameNames)];
	if (limit !== undefined) gameNames = gameNames.slice(0, limit);

	const { priced, lookupFailed } = await priceGames.run({
		gameNames,
		criteria: request.criteria,
	});

	return {
		games: priced.map((g) => ({
			name: g.name,
			market_price_euro: g.GamivoPrice as number,
			popularity: g.popularity,
			region: g.region ?? null,
			id_steam: g.id_steam ?? null,
			gamivo_id: g.gamivo_id ?? null,
		})),
		lookupFailed,
	};
};
