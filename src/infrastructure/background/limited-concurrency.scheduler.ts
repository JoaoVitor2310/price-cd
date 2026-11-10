/**
 * Executa tarefas no próprio processo, com concorrência limitada. É o motor das
 * filas **em memória** (`InMemoryJobQueue`, `InMemoryResearchQueue`), que existem
 * para dev e testes rodarem sem Redis — em produção o schema exige
 * `QUEUE_REDIS_URL`. Um reinício perde o que estava na fila.
 *
 * Não é porta da Application: as filas que ela conhece recebem dado
 * (ADR 0009), e esta recebe uma closure.
 */
export interface BackgroundScheduler {
	schedule(task: () => Promise<void>): void;
}

export class LimitedConcurrencyScheduler implements BackgroundScheduler {
	private readonly queue: Array<() => Promise<void>> = [];
	private running = 0;

	constructor(private readonly concurrency: number) {
		if (!Number.isFinite(concurrency) || concurrency < 1) {
			throw new Error(`Invalid concurrency: ${concurrency}`);
		}
	}

	schedule(task: () => Promise<void>): void {
		this.queue.push(task);
		this.pump();
	}

	private pump(): void {
		while (this.running < this.concurrency) {
			const next = this.queue.shift();
			if (!next) return;

			this.running++;
			Promise.resolve()
				.then(next)
				.catch((err) => {
					// Uma tarefa que falha não derruba o laço: as próximas continuam.
					console.error("❌ [ERROR] Background task failed:", err);
				})
				.finally(() => {
					this.running--;
					this.pump();
				});
		}
	}
}
