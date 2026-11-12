import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { logIgnoredListingLines } from "@/application/games/services/log-ignored-listing-lines.js";
import type { PriceGames } from "@/application/games/services/price-games.js";
import { HaveListing } from "@/domain/lists/have-listing.js";

export type ResearchedGames = {
	games: GameTradeInput[];
	/** Nomes que o catálogo não pôde responder. */
	lookupFailed: string[];
};

/**
 * A pesquisa de um pedido: lê a lista como uma Lista do Fornecedor, tira os nomes
 * repetidos, roda o motor e põe os jogos que passaram no formato que sai do
 * price-cd. É o que há de comum entre devolver os jogos (`ResearchGamesUseCase`)
 * e criar a Trade (`CreateResearchTrade`).
 *
 * A leitura vem **primeiro** e aqui, não no motor: é a pesquisa que recebe texto
 * colado (interface web, chatbot), com os cabeçalhos do Fornecedor (`Keys:`,
 * `GOG:`) no meio dos nomes, e um cabeçalho vale pela posição — deduplicar ou
 * cortar antes mudaria a seção de cada jogo. O Reabastecimento e a Descoberta
 * já chegam ao motor com o `.have` lido.
 *
 * `limit` corta a lista **antes** de pesquisar, para não gastar SteamCharts e
 * AllKeyShop com o que seria descartado — depois da leitura, para cabeçalho e
 * jogo de outra plataforma não ocuparem a cota.
 */
export const priceResearchGames = async (
	priceGames: PriceGames,
	request: ResearchGamesRequest,
	limit?: number,
): Promise<ResearchedGames> => {
	const listing = HaveListing.fromLines(request.gameNames);
	logIgnoredListingLines(listing);
	let gameNames = [...new Set(listing.priceableGames)];
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
