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

/**
 * `abstract class` e não `interface` pelo mesmo motivo das portas de busca:
 * precisa existir em runtime para servir de token de injeção, sem obrigar
 * `application/` a importar `@nestjs/*`. Ver `docs/nest-conceitos.md` §3.
 */
export abstract class GameTradeImporter {
    abstract import(games: GameTradeInput[], options?: GameTradeOptions): Promise<void>;
}
