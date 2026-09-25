import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";

/** Só dado: as dependências estão no construtor. */
export type EnqueueResearchGamesInput = {
	request: ResearchGamesRequest;
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
	constructor(
		private readonly scheduler: BackgroundScheduler,
		private readonly runner: ResearchGamesRunner,
	) {}

	async execute(input: EnqueueResearchGamesInput): Promise<void> {
		const { request } = input;
		const { scheduler, runner } = this;

		scheduler.schedule(async () => {
			try {
				await runner.run(request);
			} catch (error) {
				console.error("❌ [ERROR] Research games run failed:", error);
			}
		});
	}
}
