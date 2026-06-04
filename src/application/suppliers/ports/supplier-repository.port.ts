export type SupplierRow = {
    id: number;
    steam_id: string;
    is_added: 0 | 1;
};

export type TopicRow = {
    id: number;
    supplier_id: number;
    code: string;
    status: TopicStatus;
    result: string | null;
    executed_at: string;
};

export type TopicStatus =
    | "inactive"
    | "not_profitable"
    | "commented"
    | "skipped_user"
    | "no_games"
    | "failed";

export interface SupplierRepository {
    /** Retorna o supplier pelo steam_id, ou null se não existir. */
    findSupplierBySteamId(steamId: string): SupplierRow | null;

    /** Cria o supplier se não existir. Retorna o id. */
    upsertSupplier(steamId: string): number;

    /** Registra um tópico processado. */
    saveTopic(topic: Omit<TopicRow, "id" | "executed_at">): void;
}
