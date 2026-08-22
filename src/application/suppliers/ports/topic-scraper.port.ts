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
     * `true` se o dono aceitaria TF2 Keys **do CarcaDeals** — regra completa (menção a TF2 sem
     * negação/relutância, menos os vetos de tópico) em `domain/suppliers/supplier-eligibility.ts`.
     * Não é o mesmo que "o texto menciona TF2": recusar revendedor ("No reseller offers") ou
     * moeda-key em bloco ("No CSGO Keys or similar") desqualifica mesmo pedindo TF2 Keys.
     */
    wantsTf2Key: boolean;
};

/** Porta responsável por extrair os dados relevantes de um tópico de trade. */
export interface TopicScraper {
    /** Navega até `url` e retorna os dados estruturados do tópico. */
    scrape(url: string): Promise<TopicData>;
}
