import * as z from "zod";
import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import {
	StockUnavailableError,
	TradeOutcomeUnknownError,
	TradeRejectedError,
	type TradeWithOfferCreator,
	type TradeWithOfferOptions,
	type TradeWithOfferOutcome,
} from "@/application/games/ports/trade-with-offer-creator.port.js";

const TRADE_WITH_OFFER_ENDPOINT = "/api/trades";
const TIMEOUT_MS = 15_000;

/**
 * `201` do Estoque. Só o `uuid` é conferido, de propósito: a Trade já existe, e
 * recusar a resposta por um campo que o price-cd não usa (`currency`,
 * `created_at`) a transformaria numa falha.
 */
const createdSchema = z.looseObject({
	uuid: z.string().min(1),
});

/**
 * `POST /api/trades` do Sistema Estoque: cria a Trade já com a oferta ao
 * Fornecedor. Contrato em `docs/PRICE_RESEARCHER.md` do Estoque.
 *
 * Cada resposta vira um desfecho ou um dos dois erros da porta:
 *
 * | Resposta | Vira |
 * |---|---|
 * | `201 { uuid }` | `created` |
 * | `201` sem `uuid` legível | `TradeOutcomeUnknownError` |
 * | `200 { created: false }` | `not_created` |
 * | `422` | `TradeRejectedError` |
 * | `503`, outro status, timeout, rede | `StockUnavailableError` |
 *
 * As mensagens não levam a URL do Estoque: elas chegam a quem pediu, no
 * resultado `failed`.
 *
 * Sem `games[].id_steam`: o contrato da rota não tem o campo, e o Laravel o
 * ignoraria. O `GameTradeInput` é o mesmo do callback sem oferta.
 */
export class HttpTradeWithOfferCreator implements TradeWithOfferCreator {
	constructor(
		private readonly baseUrl: string,
		private readonly bearerToken: string,
	) {}

	async create(
		games: GameTradeInput[],
		options: TradeWithOfferOptions,
	): Promise<TradeWithOfferOutcome> {
		const url = `${this.baseUrl}${TRADE_WITH_OFFER_ENDPOINT}`;
		const payload: Record<string, unknown> = {
			supplier_steam_id: options.supplierSteamId,
			currency: options.currency,
			games: games.map(({ id_steam: _idSteam, ...game }) => game),
		};
		if (options.listCode) payload.list_code = options.listCode;
		if (options.title) payload.title = options.title;

		let response: Response;
		try {
			response = await fetch(url, {
				method: "POST",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				// Sem `Accept`, o Laravel responde uma rejeição com redirect para
				// HTML; com `redirect: "manual"` um 3xx chega como status, não como
				// um `200` de outra página.
				redirect: "manual",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: `Bearer ${this.bearerToken}`,
				},
				body: JSON.stringify(payload),
			});
		} catch (error) {
			const timedOut = error instanceof Error && error.name === "TimeoutError";
			console.error(
				`❌ [TRADE WITH OFFER] ${timedOut ? "Request timed out" : "Request failed"} — POST ${url}`,
				timedOut ? "" : error,
			);
			throw new StockUnavailableError(
				timedOut
					? `Sistema Estoque did not answer within ${TIMEOUT_MS / 1000}s`
					: "Sistema Estoque could not be reached",
			);
		}

		const text = await response.text().catch(() => "");

		if (response.status === 201) {
			const created = createdSchema.safeParse(parseJson(text));
			if (!created.success) {
				console.error(
					`❌ [TRADE WITH OFFER] Unexpected 201 body — POST ${url}:`,
					text,
				);
				throw new TradeOutcomeUnknownError(
					"Sistema Estoque created the Trade but answered an unexpected body",
				);
			}
			return { status: "created", tradeUuid: created.data.uuid };
		}

		if (response.status === 200) {
			const body = parseJson(text);
			if (isRecord(body) && body.created === false) {
				return { status: "not_created" };
			}
		}

		console.error(
			`❌ [TRADE WITH OFFER] HTTP ${response.status} — POST ${url}:`,
			text,
		);

		if (response.status === 422) {
			throw new TradeRejectedError(
				`Sistema Estoque rejected the Trade (422): ${text.slice(0, 500)}`,
			);
		}
		throw new StockUnavailableError(
			`Sistema Estoque answered HTTP ${response.status}`,
		);
	}
}

const parseJson = (text: string): unknown => {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;
