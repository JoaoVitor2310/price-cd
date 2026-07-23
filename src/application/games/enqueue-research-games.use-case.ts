import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";

export type EnqueueResearchGamesInput = {
	request: ResearchGamesRequest;
	scheduler: BackgroundScheduler;
	runner: ResearchGamesRunner;
};

/**
 * Enfileira a pesquisa de jogos para rodar em background.
 * O cliente recebe a confirmação imediatamente; a Trade é criada no Sistema
 * Estoque ao final do processamento, que leva minutos para listas grandes.
 *
 * Falhas do runner são registradas em log e não propagadas — não há ninguém
 * aguardando a resposta neste ponto.
 */
export class EnqueueResearchGamesUseCase {
	async execute(input: EnqueueResearchGamesInput): Promise<void> {
		const { request, scheduler, runner } = input;

		scheduler.schedule(async () => {
			try {
				await runner.run(request);
			} catch (error) {
				console.error("❌ [ERROR] Research games run failed:", error);
			}
		});
	}
}
