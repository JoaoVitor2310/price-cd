import axios from "axios";
import type {
    GamePriceInput,
    ProfitabilityChecker,
    ProfitableGameResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";

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
