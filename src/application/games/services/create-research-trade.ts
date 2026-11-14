import type {
	GameTradeImporter,
	GameTradeInput,
} from "@/application/games/ports/game-trade-importer.port.js";
import type {
	ResearchCheckpoint,
	ResearchGamesRequest,
	ResearchTradeOutcome,
} from "@/application/games/ports/research-games-runner.port.js";
import type { TradeWithOfferCreator } from "@/application/games/ports/trade-with-offer-creator.port.js";
import type { PriceGames } from "@/application/games/services/price-games.js";
import { priceResearchGames } from "@/application/games/services/price-research-games.js";
import {
	type CancellationSignal,
	JobCancelledError,
} from "@/application/shared/cancellation.js";

/** Mora na porta do runner, que o guarda no checkpoint; reexportado aqui. */
export type { ResearchTradeOutcome } from "@/application/games/ports/research-games-runner.port.js";

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
export class ResearchCancelledError extends JobCancelledError {
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
 *
 * Com `checkpoint`, os jogos aprovados ficam guardados antes de chamar o Estoque,
 * e uma tentativa seguinte os usa sem pesquisar de novo (`ResearchCheckpoint`).
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
		checkpoint?: ResearchCheckpoint,
	): Promise<ResearchTradeOutcome> {
		const games =
			checkpoint?.pricedGames ?? (await this.research(request, signal));
		// Também com os jogos da tentativa anterior: desligando, não chama o Estoque.
		if (signal?.aborted) throw new ResearchCancelledError();
		if (games.length === 0) {
			return { status: "not_created", reason: "nothing_priced" };
		}
		if (checkpoint?.pricedGames === undefined) {
			await checkpoint?.savePricedGames(games);
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
			requestUuid: request.requestUuid,
		});
		return outcome.status === "created"
			? { status: "created", tradeUuid: outcome.tradeUuid }
			: { status: "not_created", reason: "nothing_to_offer" };
	}

	/** A pesquisa em si; lança se nada passou e algum jogo não foi respondido. */
	private async research(
		request: ResearchGamesRequest,
		signal?: CancellationSignal,
	): Promise<GameTradeInput[]> {
		const { games, lookupFailed } = await priceResearchGames(
			this.priceGames,
			request,
		);
		// Antes de olhar o resultado: pesquisa interrompida não diz nada.
		if (signal?.aborted) throw new ResearchCancelledError();

		if (games.length === 0 && lookupFailed.length > 0) {
			throw new PriceResearchIncompleteError(lookupFailed.length);
		}
		return games;
	}
}
