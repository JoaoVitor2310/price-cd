import type {
	ResearchCheckpoint,
	ResearchFailureTarget,
	ResearchGamesRunner,
	ResearchJobRequest,
	ResearchTradeOutcome,
} from "@/application/games/ports/research-games-runner.port.js";
import {
	type ResearchFailureKind,
	type ResearchResult,
	type ResearchResultNotifier,
	ResultStoreUnavailableError,
} from "@/application/games/ports/research-result-notifier.port.js";
import {
	StockUnavailableError,
	TradeOutcomeUnknownError,
} from "@/application/games/ports/trade-with-offer-creator.port.js";
import {
	type CreateResearchTrade,
	PriceResearchIncompleteError,
	ResearchCancelledError,
} from "@/application/games/services/create-research-trade.js";
import {
	type ReadTopicGames,
	TopicScrapeFailedError,
} from "@/application/games/services/read-topic-games.js";
import type { CancellationSignal } from "@/application/shared/cancellation.js";

/**
 * Executa um pedido de pesquisa tirado da fila: lê o tópico (se o pedido veio de
 * um link), pesquisa, cria a Trade e, se o pedido trouxe `webhookUrl`, avisa quem
 * pediu com o Resultado da pesquisa.
 *
 * O aviso sai **depois** da resposta do Sistema Estoque: com `trade_created`, a
 * Trade já existe.
 *
 * Uma falha só propaga, para a fila registrá-la no job. O `failed` sai de
 * `reportFailure`, que a fila chama **depois** de registrar: é ela quem sabe que o
 * pedido falhou de vez, e um reenvio motivado pelo aviso já encontra o job falho
 * (ADR 0010).
 *
 * A mensagem do `failed` é **fixa por tipo**, não a do erro: o resultado sai do
 * price-cd para outro sistema, e o erro interno (Cloudflare, URL do Estoque,
 * corpo do 422) não é para lá. O detalhe fica no log e no registro do job, pelo
 * erro que propaga.
 */
export class RunResearchJobUseCase implements ResearchGamesRunner {
	constructor(
		private readonly createTrade: CreateResearchTrade,
		private readonly notifier: ResearchResultNotifier,
		private readonly readTopicGames: ReadTopicGames,
	) {}

	/**
	 * Com `checkpoint`, continua de onde a tentativa anterior parou: com o desfecho
	 * do Estoque guardado, só refaz o aviso; com os jogos aprovados, chama o Estoque
	 * com eles sem pesquisar de novo (`ResearchCheckpoint`).
	 */
	async run(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
		checkpoint?: ResearchCheckpoint,
	): Promise<void> {
		let outcome = checkpoint?.outcome;
		if (outcome === undefined) {
			outcome = await this.research(request, signal, checkpoint);
			await checkpoint?.saveOutcome(outcome);
		}
		if (request.webhookUrl === undefined) return;
		// `ResultStoreUnavailableError` propaga: a Trade já existe, e a próxima
		// tentativa, pelo checkpoint, só refaz o aviso.
		await this.notify(request, toResult(outcome));
	}

	/**
	 * Rodar de novo só quando **repetir não cria outra Trade** e a falha é
	 * passageira.
	 *
	 * - **Idempotente** é o pedido com `requestUuid` e `currency`: a Trade com
	 *   oferta, que o Estoque devolve igual na repetição do mesmo pedido. Sem um dos
	 *   dois — a interface web, a sync de bundle —, a Trade sai pelo callback sem
	 *   oferta, que cria outra a cada chamada.
	 * - **Passageira** é a falha que pode não acontecer na próxima vez: o Estoque
	 *   fora, o tópico que não abriu, o catálogo que não respondeu, o `201` sem uuid
	 *   legível, o aviso que não foi guardado. O `422` do Estoque (`TradeRejectedError`)
	 *   e o pedido montado errado dariam o mesmo resultado.
	 */
	canRetry(request: ResearchJobRequest, error: unknown): boolean {
		const idempotent =
			request.requestUuid !== undefined && request.currency !== undefined;
		return idempotent && isTransientFailure(error);
	}

	/**
	 * Com o desfecho do Estoque já guardado, a falha foi só de avisar: quem pediu
	 * recebe esse desfecho (`trade_created`, `no_trade`), não um `failed` que
	 * diria "não deu" com a Trade existindo.
	 */
	async reportFailure(
		target: ResearchFailureTarget,
		error: unknown,
		outcome?: ResearchTradeOutcome,
	): Promise<void> {
		await this.notify(
			target,
			outcome === undefined ? failedResult(error) : toResult(outcome),
		);
	}

	private async research(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
		checkpoint?: ResearchCheckpoint,
	): Promise<ResearchTradeOutcome> {
		if (!("topicUrl" in request)) {
			return this.createTrade.run(request, signal, checkpoint);
		}

		const { topicUrl, ...rest } = request;
		// Os jogos da tentativa anterior já vieram do tópico: não abre de novo.
		if (checkpoint?.pricedGames !== undefined) {
			return this.createTrade.run(
				{ ...rest, gameNames: [] },
				signal,
				checkpoint,
			);
		}
		const gameNames = await this.readTopicGames.run(topicUrl);
		// Antes de pesquisar: com o serviço desligando, abrir a sessão do AllKeyShop
		// agora subiria um Chromium depois do cleanup.
		if (signal?.aborted) throw new ResearchCancelledError();

		if (gameNames.length === 0) {
			return { status: "not_created", reason: "nothing_priced" };
		}
		return this.createTrade.run({ ...rest, gameNames }, signal, checkpoint);
	}

	private async notify(
		target: ResearchFailureTarget,
		result: ResearchResult,
	): Promise<void> {
		const { webhookUrl, requestUuid } = target;
		if (webhookUrl === undefined) return;
		// O schema da requisição exige os dois juntos; um sem o outro é pedido
		// montado à mão, e não há como dizer de qual pedido é o resultado.
		if (requestUuid === undefined) {
			throw new Error(
				"A research request with webhookUrl requires requestUuid",
			);
		}

		await this.notifier.notify({ webhookUrl, requestUuid }, result);
	}
}

const toResult = (outcome: ResearchTradeOutcome): ResearchResult => {
	if (outcome.status === "not_created") return { result: "no_trade" };
	// Só a Trade com oferta devolve uuid, e o webhook exige moeda — sem uuid aqui
	// é um pedido com webhook que escapou da validação. Lança em vez de montar o
	// `failed`: quem avisa falha é a fila (`reportFailure`), uma origem só.
	if (outcome.tradeUuid === undefined) {
		throw new Error(
			"A research request with webhookUrl requires currency: only the Trade with offer returns a uuid",
		);
	}
	return { result: "trade_created", tradeUuid: outcome.tradeUuid };
};

const isTransientFailure = (error: unknown): boolean =>
	error instanceof StockUnavailableError ||
	error instanceof TopicScrapeFailedError ||
	error instanceof PriceResearchIncompleteError ||
	error instanceof TradeOutcomeUnknownError ||
	error instanceof ResultStoreUnavailableError;

/** O que quem pediu lê, por tipo — nunca o texto do erro interno. */
export const FAILURE_MESSAGES: Record<ResearchFailureKind, string> = {
	scrape_failed: "The SteamTrades topic could not be read.",
	pricing_failed: "The price research could not be completed.",
	stock_unavailable: "Sistema Estoque could not create the Trade right now.",
};

const failureKind = (error: unknown): ResearchFailureKind => {
	if (error instanceof TopicScrapeFailedError) return "scrape_failed";
	if (error instanceof StockUnavailableError) return "stock_unavailable";
	return "pricing_failed";
};

const failedResult = (error: unknown): ResearchResult => {
	const kind = failureKind(error);
	return {
		result: "failed",
		failure: { kind, message: FAILURE_MESSAGES[kind] },
	};
};
