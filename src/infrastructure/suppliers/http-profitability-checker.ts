import axios from "axios";
import type {
    GamePriceInput,
    ProfitabilityChecker,
    ProfitableGameResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";

const PROFITABILITY_ENDPOINT = "/suppliers/evaluate";

/**
 * Implementação de `ProfitabilityChecker` via HTTP.
 * Delega o cálculo de rentabilidade em keys TF2 ao Sistema Estoque,
 * que conhece as taxas de Marketplaces, a cotação EUR/BRL e a margem de lucro atual.
 */
export class HttpProfitabilityChecker implements ProfitabilityChecker {
    constructor(
        private readonly baseUrl: string,
        private readonly bearerToken: string,
    ) {}

    async evaluate(games: GamePriceInput[]): Promise<ProfitableGameResult[]> {
        const url = `${this.baseUrl}${PROFITABILITY_ENDPOINT}`;

        try {
            const response = await axios.post<{ profitable: ProfitableGameResult[] }>(
                url,
                { games },
                {
                    timeout: 10_000,
                    headers: { Authorization: `Bearer ${this.bearerToken}` },
                }
            );
            return response.data.profitable;
        } catch (err) {
            if (axios.isAxiosError(err)) {
                console.error(`❌ [PROFITABILITY] HTTP ${err.response?.status ?? "no response"} — POST ${url}`);
                console.error(`❌ [PROFITABILITY] Response body:`, err.response?.data);
            }
            throw err;
        }
    }
}
