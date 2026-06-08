import axios from "axios";
import type {
    GamePriceInput,
    ProfitabilityChecker,
    ProfitableGameResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";

/**
 * Implementação de `ProfitabilityChecker` via HTTP.
 * Delega o cálculo de rentabilidade em keys TF2 ao Sistema Estoque,
 * que conhece as taxas de Steam, a cotação EUR/BRL e a margem de lucro atual.
 */
export class HttpProfitabilityChecker implements ProfitabilityChecker {
    constructor(private readonly apiUrl: string) {}

    async evaluate(games: GamePriceInput[]): Promise<ProfitableGameResult[]> {
        const response = await axios.post<{ profitable: ProfitableGameResult[] }>(
            this.apiUrl,
            { games },
            { timeout: 10_000 }
        );
        return response.data.profitable;
    }
}
