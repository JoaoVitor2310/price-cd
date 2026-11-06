import type { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import type {
	CancellationSignal,
	ResearchGamesRequest,
} from "@/application/games/ports/research-games-runner.port.js";
import type { TradeWithOfferCreator } from "@/application/games/ports/trade-with-offer-creator.port.js";
import type { PriceGames } from "@/application/games/services/price-games.js";
import { priceResearchGames } from "@/application/games/services/price-research-games.js";

/**
 * Como terminou o pedido.
 *
 * - `created`: a Trade existe. `tradeUuid` só vem da Trade **com oferta** — a
 *   rota sem oferta do Estoque não devolve identificador.
 * - `not_created`: nenhum jogo passou nos filtros (o Estoque nem é chamado), ou
 *   o Estoque não viu nada a ofertar.
 */
export type ResearchTradeOutcome =
	| { status: "created"; tradeUuid?: string }
	| { status: "not_created"; reason: "nothing_priced" | "nothing_to_offer" };

/**
 * Nenhum jogo passou e o catálogo não respondeu por pelo menos um: não dá para
 * dizer que "nada passou nos filtros". O pedido falha e pode rodar de novo; o
 * que já foi pesquisado está no cache, então a repetição é barata.
 */
export class PriceResearchIncompleteError extends Error {
	constructor(failedCount: number) {
		super(`No game priced, and ${failedCount} lookup(s) failed`);
		this.name = "PriceResearchIncompleteError";
	}
}

/**
 * O serviço está desligando e o pedido já voltou para a fila. Fechar o browser
 * não derruba a pesquisa — os jogos restantes só viram falha de catálogo —, então
 * é preciso parar aqui, antes de criar uma Trade com a lista pela metade.
 */
export class ResearchCancelledError extends Error {
	constructor() {
		super("The research was cancelled by the shutdown");
		this.name = "ResearchCancelledError";
	}
}

/**
 * Pesquisa e, se algum jogo passar, cria a Trade. Com `currency`, ela nasce com a
 * oferta que o Sistema Estoque decide e o desfecho traz o uuid; sem, é a Trade
 * sem oferta de sempre.
 *
 * Com falha parcial no catálogo, a Trade nasce com o que deu certo: perder uma
 * lista de 50 jogos por um timeout custaria mais do que a Trade menor. Quem ficou
 * de fora está no log (`logFailedPriceLookups`).
 *
 * Falhas propagam: as da pesquisa como vieram, as do Estoque com oferta como
 * `StockUnavailableError` ou `TradeRejectedError` — é por esses tipos que quem
 * chama separa uma da outra.
 */
export class CreateResearchTrade {
	constructor(
		private readonly priceGames: PriceGames,
		private readonly tradeImporter: GameTradeImporter,
		private readonly tradeWithOfferCreator: TradeWithOfferCreator,
	) {}

	async run(
		request: ResearchGamesRequest,
		signal?: CancellationSignal,
	): Promise<ResearchTradeOutcome> {
		const { games, lookupFailed } = await priceResearchGames(
			this.priceGames,
			request,
		);
		// Antes de olhar o resultado: pesquisa interrompida não diz nada.
		if (signal?.aborted) throw new ResearchCancelledError();

		if (games.length === 0) {
			if (lookupFailed.length > 0) {
				throw new PriceResearchIncompleteError(lookupFailed.length);
			}
			return { status: "not_created", reason: "nothing_priced" };
		}

		const { supplierSteamId, listCode, title, currency } = request;

		if (currency === undefined) {
			await this.tradeImporter.import(games, {
				supplier_steam_id: supplierSteamId,
				list_code: listCode,
				title,
			});
			return { status: "created" };
		}

		// O schema da requisição garante o Steam ID junto da moeda; chegar aqui
		// sem ele é pedido montado à mão, e o Estoque o recusaria de qualquer jeito.
		if (!supplierSteamId) {
			throw new Error("A Trade with an offer requires the supplier Steam ID");
		}

		const outcome = await this.tradeWithOfferCreator.create(games, {
			supplierSteamId,
			currency,
			listCode,
			title,
		});
		return outcome.status === "created"
			? { status: "created", tradeUuid: outcome.tradeUuid }
			: { status: "not_created", reason: "nothing_to_offer" };
	}
}
