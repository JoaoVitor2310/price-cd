import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";
import type {
	ResearchQueue,
	ResearchQueueStatus,
} from "@/application/games/ports/research-queue.port.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";

/**
 * A fila da pesquisa sem armazenamento: o comportamento de antes do ADR 0009.
 * Existe para dev e testes rodarem sem Redis — em produção o schema do ambiente
 * exige `QUEUE_REDIS_URL`, então este adapter nunca chega lá.
 *
 * Um reinício perde o que estava na fila, e a falha de uma execução só vai para
 * o log.
 */
export class InMemoryResearchQueue implements ResearchQueue {
	constructor(
		private readonly scheduler: BackgroundScheduler,
		private readonly runner: ResearchGamesRunner,
	) {}

	async enqueue(request: ResearchGamesRequest): Promise<void> {
		this.scheduler.schedule(async () => {
			try {
				await this.runner.run(request);
			} catch (error) {
				console.error("❌ [ERROR] Research games run failed:", error);
			}
		});
	}

	async status(): Promise<ResearchQueueStatus> {
		return "in-memory";
	}
}
