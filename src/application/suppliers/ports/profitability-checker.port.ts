/** Dados do fornecedor enviados ao Sistema Estoque para identificação e registro. */
export type SupplierInput = {
    steam_id: string;
    url: string;
};

/** Jogo com preço já descoberto pelo price researcher, pronto para avaliação de rentabilidade. */
export type GamePriceInput = {
    name: string;
    /** Preço em EUR obtido no AllKeyShop/Gamivo. */
    price_euro: number;
    /** Pico de jogadores em 24h no SteamCharts. */
    popularity: number;
    /** Região da oferta: "global", "eu", "row", ou null se não identificado. */
    region: string | null;
};

export type ProfitableGameResult = {
    name: string;
    price_euro: number;
    popularity: number;
    region: string | null;
    /** Preço em keys TF2, calculado pelo Sistema Estoque. */
    tf2_price: number;
};

export type ProspectResult = {
    profitable: ProfitableGameResult[];
    /** Se o fornecedor já está adicionado como contato no Sistema Estoque. */
    is_added: boolean;
};

export interface ProfitabilityChecker {
    evaluate(supplier: SupplierInput, games: GamePriceInput[]): Promise<ProspectResult>;
}
