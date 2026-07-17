/** Dados do fornecedor enviados ao Sistema Estoque para identificação e registro. */
export type SupplierInput = {
    steam_id: string;
    /** Código do tópico no SteamTrades (ex.: `G0eXM`). Usado pelo Sistema Estoque para rastrear histórico por tópico. */
    list_code: string;
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
    /** ID do produto na Gamivo, ou null se não identificado. */
    gamivo_id: string | null;
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
    /** `true` se o price-cd deve postar comentário no tópico. Decisão tomada pelo Sistema Estoque. */
    should_comment: boolean;
    /** ISO 8601 do último comentário registrado para este `list_code`. `null` se nunca comentamos. Usado para logging. */
    last_commented_at: string | null;
    /** `true` se a lista de jogos mudou desde o último comentário registrado. Usado para logging. */
    games_changed: boolean;
};

export interface ProfitabilityChecker {
    evaluate(supplier: SupplierInput, games: GamePriceInput[]): Promise<ProspectResult>;
}
