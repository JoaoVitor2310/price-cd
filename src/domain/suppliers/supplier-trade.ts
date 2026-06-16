import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

export type { ProfitableGameResult as ProfitableGame };

export type SupplierTrade = {
    tradeUrl: string;
    code: string;
    authorName: string;
    steamId: string;
    profitableGames: ProfitableGameResult[];
};
