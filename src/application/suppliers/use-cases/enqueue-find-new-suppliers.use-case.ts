import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type { FindNewSuppliersRunner } from "@/application/suppliers/ports/find-new-suppliers-runner.port.js";

export type EnqueueFindNewSuppliersInput = {
    scheduler: BackgroundScheduler;
    runner: FindNewSuppliersRunner;
};

/**
 * Enfileira a varredura de descoberta de fornecedores para rodar em background.
 * O cliente HTTP recebe a confirmação imediatamente; a varredura pode levar minutos
 * (até 100 páginas do SteamTrades, uma pesquisa de preços por tópico elegível).
 *
 * Falhas do runner são registradas em log e não propagadas — não há ninguém
 * aguardando a resposta neste ponto.
 */
export class EnqueueFindNewSuppliersUseCase {
    async execute(input: EnqueueFindNewSuppliersInput): Promise<void> {
        const { scheduler, runner } = input;

        scheduler.schedule(async () => {
            try {
                const result = await runner.run();
                console.log(
                    `✅ [SUPPLIERS] Background search finished: ${result.pagesVisited} page(s) visited, ${result.topicsProcessed} topic(s) processed, ${result.suppliersCommented} supplier(s) commented.`,
                );
            } catch (error) {
                console.error("❌ [ERROR] Find new suppliers run failed:", error);
            }
        });
    }
}
