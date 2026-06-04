export type GamePriceInput = {
    name: string;
    priceEur: number;
    popularity: number;
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
