/**
 * O cancelamento de um job de fila, do jeito que a Application o enxerga.
 *
 * As filas duráveis (ADR 0009) devolvem o job em andamento no desligamento e o
 * rodam de novo no próximo boot. Fechar o browser nem sempre derruba quem está
 * executando — uma busca que falha vira "jogo sem preço", não erro —, então quem
 * executa confere o sinal antes de cada efeito que não pode repetir (criar a
 * Trade no Estoque, pedir ao Estoque a decisão de comentar).
 */

/**
 * Se quem executa pediu para parar. Só a forma que a Application precisa: o
 * `AbortSignal` da plataforma a satisfaz, sem a Application depender dele.
 */
export type CancellationSignal = { readonly aborted: boolean };

/** O job parou porque o serviço está desligando; ele volta a rodar inteiro. */
export class JobCancelledError extends Error {
	constructor(message = "The job was cancelled by the shutdown") {
		super(message);
		this.name = "JobCancelledError";
	}
}

export const throwIfCancelled = (signal?: CancellationSignal): void => {
	if (signal?.aborted) throw new JobCancelledError();
};
