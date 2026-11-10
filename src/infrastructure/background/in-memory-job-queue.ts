import type { BackgroundScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";

/**
 * A `BullmqJobQueue` sem armazenamento, para dev e testes rodarem sem Redis — em
 * produção o schema do ambiente exige `QUEUE_REDIS_URL`. Um reinício perde o que
 * estava na fila, e não há registro das execuções: a falha fica só no log.
 *
 * Sem sinal de cancelamento: nada aqui sobrevive ao desligamento para rodar de
 * novo, então não há o que devolver.
 */
export class InMemoryJobQueue<T> {
	constructor(
		private readonly scheduler: BackgroundScheduler,
		private readonly run: (request: T) => Promise<void>,
		/** Nome nos logs: "lists". */
		private readonly label: string,
	) {}

	async enqueue(request: T): Promise<void> {
		this.scheduler.schedule(async () => {
			try {
				await this.run(request);
			} catch (error) {
				console.error(`❌ [ERROR] ${this.label} run failed:`, error);
			}
		});
	}
}
