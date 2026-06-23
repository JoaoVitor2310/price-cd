import axios from "axios";
import type {
    SupplierInput,
    GamePriceInput,
    ProfitabilityChecker,
    ProspectResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";

const PROFITABILITY_ENDPOINT = "/suppliers/prospect";

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

    async evaluate(supplier: SupplierInput, games: GamePriceInput[]): Promise<ProspectResult> {
        const url = `${this.baseUrl}${PROFITABILITY_ENDPOINT}`;

        try {
            const response = await axios.post<ProspectResult>(
                url,
                { supplier, games },
                {
                    timeout: 10_000,
                    headers: { Authorization: `Bearer ${this.bearerToken}` },
                }
            );
            return response.data;
        } catch (err) {
            if (axios.isAxiosError(err)) {
                console.error(`❌ [PROFITABILITY] HTTP ${err.response?.status ?? "no response"} — POST ${url}`);
                console.error(`❌ [PROFITABILITY] Response body:`, err.response?.data);
            }
            throw err;
        }
    }
}
