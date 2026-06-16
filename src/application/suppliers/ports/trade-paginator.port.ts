/** Porta responsável por paginar as listagens de trades do SteamTrades. */
export interface TradePaginator {
    /**
     * Retorna os codes e URLs dos tópicos encontrados numa página de listagem.
     * Página 1 é a home (`/`); páginas seguintes usam `/trades/search?page=N`.
     */
    getTopicsFromPage(page: number): Promise<Array<{ code: string; url: string }>>;
}
