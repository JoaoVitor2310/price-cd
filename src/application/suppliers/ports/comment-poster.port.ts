import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

export interface CommentPoster {
    post(tradeUrl: string, games: ProfitableGameResult[]): Promise<void>;
}
