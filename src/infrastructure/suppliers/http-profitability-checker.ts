import type {
    SupplierInput,
    GamePriceInput,
    ProfitabilityChecker,
    ProspectResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";

const PROFITABILITY_ENDPOINT = "/suppliers/prospect";

/**
 * Implementação de `ProfitabilityChecker` via HTTP.
 * Delega ao Sistema Estoque: cálculo de rentabilidade em keys TF2 e decisão de comentar (`should_comment`).
 */
export class HttpProfitabilityChecker implements ProfitabilityChecker {
    constructor(
        private readonly baseUrl: string,
        private readonly bearerToken: string,
    ) {}

    async evaluate(supplier: SupplierInput, games: GamePriceInput[]): Promise<ProspectResult> {
        const url = `${this.baseUrl}${PROFITABILITY_ENDPOINT}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        try {
            const response = await fetch(url, {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.bearerToken}`,
                },
                body: JSON.stringify({
                    supplier_steam_id: supplier.steam_id,
                    list_code: supplier.list_code,
                    games,
                }),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => undefined);
                console.error(`❌ [PROFITABILITY] HTTP ${response.status} — POST ${url}`);
                console.error(`❌ [PROFITABILITY] Response body:`, body);
                throw new Error(`POST ${url} failed with status ${response.status}`);
            }

            return response.json() as Promise<ProspectResult>;
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                console.error(`❌ [PROFITABILITY] Request timed out — POST ${url}`);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
