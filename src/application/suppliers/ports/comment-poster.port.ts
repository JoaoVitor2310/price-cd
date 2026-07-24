import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

/** Porta responsável por postar o comentário de interesse numa trade do SteamTrades. */
export interface CommentPoster {
    /**
     * Abre a página da trade e posta um comentário com os jogos rentáveis encontrados
     * e o total da Trade em TF2 Keys (calculado pelo Sistema Estoque).
     * Requer sessão autenticada no SteamTrades.
     */
    post(tradeUrl: string, games: ProfitableGameResult[], totalTf2Price: number): Promise<void>;
}
