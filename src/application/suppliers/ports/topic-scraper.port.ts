import type { OfferCurrency } from "@/domain/suppliers/offer.js";

/** Dados extraídos de uma página de tópico individual no SteamTrades. */
export type TopicData = {
    /** Nome do autor exibido em `.author_name`. */
    authorName: string;
    /** Steam ID de 64 bits do dono do tópico, extraído do href `/user/{steam_id}`. */
    steamId: string;
    /** Lista de jogos da seção `.have` (linhas não-vazias). */
    games: string[];
    /** `true` se a trade está marcada como inativa (presença de `.notification.yellow`). */
    isInactive: boolean;
    /**
     * A Moeda de oferta desta Lista: em que moeda o CarcaDeals propõe pagar o dono. `null` se ele
     * não aceita nenhuma que a gente ofereça. Regra completa (menção sem negação/relutância,
     * menos os vetos de tópico, mais a precedência TF2 > dólar > euro) em
     * `domain/suppliers/supplier-eligibility.ts`.
     * Não é o mesmo que "o texto menciona um meio de pagamento": recusar revendedor ("No reseller
     * offers") desqualifica mesmo aceitando tudo.
     */
    offerCurrency: OfferCurrency | null;
};

/** Porta responsável por extrair os dados relevantes de um tópico de trade. */
export abstract class TopicScraper {
    /** Navega até `url` e retorna os dados estruturados do tópico. */
    abstract scrape(url: string): Promise<TopicData>;
}
