import type { Offer } from "@/domain/suppliers/offer.js";

/** Porta responsável por postar o comentário de interesse numa trade do SteamTrades. */
export abstract class CommentPoster {
    /**
     * Abre a página da trade e posta um comentário com os jogos rentáveis encontrados e o total,
     * ambos já na Moeda de oferta da Lista (`offer.currency`), calculados pelo Sistema Estoque.
     * Requer sessão autenticada no SteamTrades.
     */
    abstract post(tradeUrl: string, offer: Offer): Promise<void>;
}
