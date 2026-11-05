import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { ResearchQueue } from "@/application/games/ports/research-queue.port.js";

/** Só dado: as dependências estão no construtor. */
export type EnqueueResearchGamesInput = {
	request: ResearchGamesRequest;
};

/**
 * Enfileira a pesquisa de jogos para rodar em background.
 * O cliente recebe a confirmação assim que o pedido está guardado; a Trade é
 * criada no Sistema Estoque ao final do processamento, que leva minutos para
 * listas grandes.
 *
 * Uma falha ao **guardar** o pedido propaga: o cliente ainda está esperando e
 * recebe o erro. Uma falha ao **executar** acontece depois, no worker da fila,
 * e fica registrada no job — ninguém aguarda a resposta neste ponto (o aviso a
 * quem pediu é o webhook, `docs/INTEGRACAO_CHATBOT.md`).
 */
export class EnqueueResearchGamesUseCase {
	constructor(private readonly queue: ResearchQueue) {}

	async execute(input: EnqueueResearchGamesInput): Promise<void> {
		await this.queue.enqueue(input.request);
	}
}
