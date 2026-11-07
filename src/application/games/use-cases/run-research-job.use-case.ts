import type {
	CancellationSignal,
	ResearchFailureTarget,
	ResearchGamesRunner,
	ResearchJobRequest,
} from "@/application/games/ports/research-games-runner.port.js";
import type {
	ResearchFailureKind,
	ResearchResult,
	ResearchResultNotifier,
} from "@/application/games/ports/research-result-notifier.port.js";
import { StockUnavailableError } from "@/application/games/ports/trade-with-offer-creator.port.js";
import {
	type CreateResearchTrade,
	ResearchCancelledError,
	type ResearchTradeOutcome,
} from "@/application/games/services/create-research-trade.js";
import {
	type ReadTopicGames,
	TopicScrapeFailedError,
} from "@/application/games/services/read-topic-games.js";

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

	async run(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
	): Promise<void> {
		const outcome = await this.research(request, signal);
		if (request.webhookUrl === undefined) return;
		await this.notify(request, toResult(outcome));
	}

	async reportFailure(
		target: ResearchFailureTarget,
		error: unknown,
	): Promise<void> {
		await this.notify(target, failedResult(error));
	}

	private async research(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
	): Promise<ResearchTradeOutcome> {
		if (!("topicUrl" in request)) return this.createTrade.run(request, signal);

		const { topicUrl, ...rest } = request;
		const gameNames = await this.readTopicGames.run(topicUrl);
		// Antes de pesquisar: com o serviço desligando, abrir a sessão do AllKeyShop
		// agora subiria um Chromium depois do cleanup.
		if (signal?.aborted) throw new ResearchCancelledError();

		if (gameNames.length === 0) {
			return { status: "not_created", reason: "nothing_priced" };
		}
		return this.createTrade.run({ ...rest, gameNames }, signal);
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
