export type GameTradeInput = {
    name: string;
    price_euro: number;
    popularity: number;
    region: string | null;
};

export type GameTradeOptions = {
    supplier_steam_id?: string;
    list_code?: string;
};

export interface GameTradeImporter {
    import(games: GameTradeInput[], options?: GameTradeOptions): Promise<void>;
}
