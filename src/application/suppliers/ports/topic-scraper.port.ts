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
};

/** Porta responsável por extrair os dados relevantes de um tópico de trade. */
export interface TopicScraper {
    /** Navega até `url` e retorna os dados estruturados do tópico. */
    scrape(url: string): Promise<TopicData>;
}
