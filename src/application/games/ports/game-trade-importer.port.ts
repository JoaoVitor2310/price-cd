export type GameTradeInput = {
    name: string;
    price_euro: number;
    popularity: number;
    region: string | null;
    id_steam: string | null;
    gamivo_id: string | null;
};

export type GameTradeOptions = {
    supplier_steam_id?: string;
    list_code?: string;
    title?: string;
};

export interface GameTradeImporter {
    import(games: GameTradeInput[], options?: GameTradeOptions): Promise<void>;
}
