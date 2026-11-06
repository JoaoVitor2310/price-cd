import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { OfferCurrency } from "@/domain/suppliers/offer.js";

export type TradeWithOfferOptions = {
	/** SteamID64 do Fornecedor: o Estoque o exige, porque a oferta é feita a alguém. */
	supplierSteamId: string;
	currency: OfferCurrency;
	listCode?: string;
	title?: string;
};

/**
 * O que o Sistema Estoque decidiu.
 *
 * - `created`: a Trade existe.
 * - `not_created`: nada a ofertar (Fornecedor bloqueado, nenhum jogo ofertável).
 *   Não é erro; o Estoque não diz o motivo.
 */
export type TradeWithOfferOutcome =
	| { status: "created"; tradeUuid: string }
	| { status: "not_created" };

/**
 * O Sistema Estoque não pôde responder agora: fora do ar, timeout, sem cotação
 * da TF2 Key (503) ou qualquer resposta inesperada. Tentar mais tarde pode dar
 * certo — é o `stock_unavailable` do resultado.
 */
export class StockUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StockUnavailableError";
	}
}

/**
 * O Sistema Estoque recusou o pedido como inválido (422). Tentar de novo com o
 * mesmo pedido dá o mesmo resultado — conta como falha da precificação.
 */
export class TradeRejectedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TradeRejectedError";
	}
}

/**
 * O Sistema Estoque confirmou a criação, mas não deu para ler o uuid: a Trade
 * **existe**, só não se sabe qual é. Não é `StockUnavailableError` de propósito —
 * aquele convida a repetir, e repetir aqui criaria uma segunda Trade.
 */
export class TradeOutcomeUnknownError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TradeOutcomeUnknownError";
	}
}

/**
 * Criar Trade **com oferta** no Sistema Estoque: quem decide o que ofertar, e em
 * quanto, é o Estoque (ADR 0001). Diferente do `GameTradeImporter`, que cria a
 * Trade sem oferta e não devolve nada: aqui a resposta importa, porque o uuid da
 * Trade é o que volta para quem pediu.
 *
 * Falhas são sempre um dos três erros acima — quem chama classifica por tipo,
 * sem conhecer status HTTP.
 */
export abstract class TradeWithOfferCreator {
	abstract create(
		games: GameTradeInput[],
		options: TradeWithOfferOptions,
	): Promise<TradeWithOfferOutcome>;
}
