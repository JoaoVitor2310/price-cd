import type { FindNewSuppliersResult } from "@/application/suppliers/find-new-suppliers.use-case.js";

/**
 * Porta para executar a varredura completa de descoberta de fornecedores.
 * Isola `EnqueueFindNewSuppliersUseCase` da montagem concreta das dependências
 * (browser Puppeteer, sessão do SteamTrades, integração com o Sistema Estoque).
 */
export interface FindNewSuppliersRunner {
    run(): Promise<FindNewSuppliersResult>;
}
