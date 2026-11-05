import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";

/**
 * `up`/`down`: fila durável, com o armazenamento respondendo ou não.
 * `in-memory`: sem armazenamento configurado — os pedidos vivem no processo e
 * um reinício os perde. Só existe fora de produção (ver o schema do ambiente).
 */
export type ResearchQueueStatus = "up" | "down" | "in-memory";

/**
 * O armazenamento da fila não está aceitando pedidos agora. É a falha esperada
 * de `enqueue` — quem chama ainda está na requisição e pode tentar de novo.
 */
export class ResearchQueueUnavailableError extends Error {
	constructor(reason: string) {
		super(`Research queue unavailable: ${reason}`);
		this.name = "ResearchQueueUnavailableError";
	}
}

/**
 * A fila da pesquisa autenticada. Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Recebe **dado**, não uma função: um pedido precisa sobreviver a um reinício, e
 * uma closure não sai do processo. É por isso que a pesquisa não usa mais a
 * `BackgroundScheduler`, que continua servindo `lists` e `suppliers`.
 *
 * `enqueue` só resolve depois de o pedido estar guardado. Se não der para
 * guardar, lança — quem chamou ainda está na requisição e recebe o erro, em vez
 * de um `202` que promete uma Trade que nunca virá.
 *
 * `abstract class` pelo mesmo motivo das outras portas: é o token de injeção.
 */
export abstract class ResearchQueue {
	abstract enqueue(request: ResearchGamesRequest): Promise<void>;
	/** Para o health. */
	abstract status(): Promise<ResearchQueueStatus>;
}
