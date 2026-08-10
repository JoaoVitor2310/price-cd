/** Porta responsável por paginar as listagens de trades do SteamTrades. */
export interface TradePaginator {
    /**
     * Retorna os codes, URLs e status de fechamento dos tópicos encontrados numa página de
     * listagem, filtrada pelo termo de busca informado (`have=<searchTerm>` no SteamTrades —
     * o site casa isso contra o `.want` de cada listagem, i.e. "o que eu tenho" vs. "o que o
     * fornecedor pede"). `isClosed` vem do cadeado exibido direto na listagem — diferente de
     * `TopicData.isInactive`, que só é conhecido depois de abrir o tópico.
     */
    getTopicsFromPage(page: number, searchTerm: string): Promise<Array<{ code: string; url: string; isClosed: boolean }>>;
}
