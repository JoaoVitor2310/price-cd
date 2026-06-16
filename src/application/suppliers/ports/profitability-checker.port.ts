/** Jogo com preço já descoberto pelo price researcher, pronto para avaliação de rentabilidade. */
export type GamePriceInput = {
    name: string;
    /** Preço em EUR obtido no AllKeyShop/Gamivo. */
    priceEur: number;
    /** Pico de jogadores em 24h no SteamCharts. */
    popularity: number;
    /** Região da oferta (ex.: "Global", "EU"), ou null se não identificado. */
    region: string | null;
};

export type ProfitableGameResult = {
    name: string;
    priceEur: number;
    popularity: number;
    region: string | null;
    /** Preço em keys TF2, calculado pelo Sistema Estoque. */
    tf2_price: number;
};

export interface ProfitabilityChecker {
    /**
     * Envia os jogos com preço para o Sistema Estoque e recebe de volta
     * apenas os que são rentáveis (keys > 0), com o valor em keys calculado lá.
     */
    evaluate(games: GamePriceInput[]): Promise<ProfitableGameResult[]>;
}
