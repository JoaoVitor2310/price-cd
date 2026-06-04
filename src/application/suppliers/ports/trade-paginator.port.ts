export interface TradePaginator {
    /** Retorna os codes e URLs dos tópicos de uma página de listagem. */
    getTopicsFromPage(page: number): Promise<Array<{ code: string; url: string }>>;
}
