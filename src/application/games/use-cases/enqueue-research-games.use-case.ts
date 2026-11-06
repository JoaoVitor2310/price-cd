import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { ResearchQueue } from "@/application/games/ports/research-queue.port.js";
import type { ResearchResultNotifier } from "@/application/games/ports/research-result-notifier.port.js";
import { isAllowedWebhookTarget } from "@/application/games/webhook-target.js";

/** Só dado: as dependências estão no construtor. */
export type EnqueueResearchGamesInput = {
	request: ResearchGamesRequest;
};

/**
 * O pedido é válido na forma, mas não pode ser aceito — quem pediu precisa
 * mudá-lo. A apresentação responde 400.
 */
export class InvalidResearchRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidResearchRequestError";
	}
}

/**
 * Enfileira a pesquisa de jogos para rodar em background.
 * O cliente recebe a confirmação assim que o pedido está guardado; a Trade é
 * criada no Sistema Estoque ao final do processamento, que leva minutos para
 * listas grandes.
 *
 * Uma falha ao **guardar** o pedido propaga: o cliente ainda está esperando e
 * recebe o erro. Uma falha ao **executar** acontece depois, no worker da fila:
 * fica registrada no job e, se o pedido trouxe `webhookUrl`, vira o resultado
 * `failed` avisado a quem pediu (`RunResearchJobUseCase`).
 *
 * `allowedWebhookHosts` vem da configuração: um webhook para host fora da lista
 * é recusado aqui, enquanto quem pediu ainda pode corrigir.
 *
 * ## O mesmo `requestUuid` de novo
 *
 * Um resultado por pedido (ADR 0010). Quem pede pode reenviar — por timeout de
 * rede, ou ao subir de novo —, e o que acontece depende de onde o primeiro está:
 *
 * - **na fila ou rodando:** nada; ele já vai avisar;
 * - **concluído:** o resultado guardado é entregue de novo, sem pesquisar — o
 *   pedido já criou (ou não) a Trade, e pesquisar de novo poderia criar outra.
 *   Se quem reenvia espera um webhook e não há resultado guardado (o primeiro
 *   pedido não tinha `webhookUrl`, ou o registro expirou), é recusado: um `202`
 *   prometeria um aviso que nunca sai;
 * - **falhou:** roda de novo, do zero. Quase sempre a falha não criou Trade (o
 *   Estoque só é chamado no fim), então é uma nova tentativa legítima. O
 *   registro e o aviso `failed` antigos são apagados, senão a fila ignoraria o
 *   pedido e o aviso novo. Exceções conhecidas, que podem deixar uma Trade
 *   repetida: o Estoque criou a Trade e a resposta não chegou (timeout), ou a
 *   Trade foi criada e o resultado não pôde ser guardado, ou o Estoque
 *   respondeu `201` sem `uuid` legível (`TradeOutcomeUnknownError`). Fecham com a
 *   idempotência do Estoque pelo `requestUuid` (`docs/INTEGRACAO_CHATBOT.md`,
 *   pergunta 4).
 *
 * Sem `requestUuid` não há como reconhecer um reenvio: cada pedido roda.
 */
export class EnqueueResearchGamesUseCase {
	constructor(
		private readonly queue: ResearchQueue,
		private readonly notifier: ResearchResultNotifier,
		private readonly allowedWebhookHosts: readonly string[],
	) {}

	async execute(input: EnqueueResearchGamesInput): Promise<void> {
		const { webhookUrl, requestUuid } = input.request;
		if (
			webhookUrl !== undefined &&
			!isAllowedWebhookTarget(webhookUrl, this.allowedWebhookHosts)
		) {
			throw new InvalidResearchRequestError("webhook_url host is not allowed");
		}

		if (requestUuid !== undefined) {
			const previous = await this.queue.previousRun(requestUuid);
			if (previous === "pending") return;
			if (previous === "completed") {
				const redelivered = await this.notifier.redeliver(requestUuid);
				if (!redelivered && webhookUrl !== undefined) {
					throw new InvalidResearchRequestError(
						"request_uuid already finished and has no stored result",
					);
				}
				return;
			}
			if (previous === "failed") {
				await this.notifier.forget(requestUuid);
				await this.queue.forget(requestUuid);
			}
		}

		await this.queue.enqueue(input.request);
	}
}
