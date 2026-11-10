import type { CancellationSignal } from "@/application/shared/cancellation.js";
import type { FindNewSuppliersResult } from "@/application/suppliers/use-cases/find-new-suppliers.use-case.js";

/**
 * Porta para executar a varredura completa de descoberta de fornecedores.
 * É o que a `SupplierDiscoveryQueue` executa: isola a fila da montagem concreta
 * das dependências (browser Puppeteer, sessão do SteamTrades, integração com o
 * Sistema Estoque).
 *
 * `signal` é a fila avisando que o pedido foi devolvido a ela (desligamento) e
 * vai rodar de novo: a varredura para antes de pedir ao Estoque outra decisão.
 */
export interface FindNewSuppliersRunner {
    run(signal?: CancellationSignal): Promise<FindNewSuppliersResult>;
}
