/** Linha da tabela `suppliers` — representa um vendedor único no SteamTrades. */
export type SupplierRow = {
    id: number;
    steam_id: string;
    /** `1` se o usuário já foi adicionado como amigo no Steam, `0` caso contrário. */
    is_added: 0 | 1;
};

/** Linha da tabela `topics` — representa um tópico de trade processado. */
export type TopicRow = {
    id: number;
    supplier_id: number;
    /** Código único do tópico no SteamTrades (ex.: `FjgPJ`). */
    code: string;
    status: TopicStatus;
    /** Resultado legível salvo para referência futura (jogos comentados ou mensagem de erro). */
    result: string | null;
    executed_at: string;
};

/**
 * Status de processamento de um tópico:
 * - `inactive`: trade marcada como inativa no SteamTrades
 * - `not_profitable`: nenhum jogo da trade gerou lucro suficiente em keys TF2
 * - `commented`: comentário postado com sucesso
 * - `skipped_user`: já existe comentário "Interested" recente nessa trade
 * - `no_games`: seção `.have` vazia ou sem jogos reconhecíveis
 * - `failed`: erro inesperado durante o processamento
 */
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
