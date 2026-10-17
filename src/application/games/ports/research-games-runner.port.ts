import type { SearchCriteria } from "@/domain/games/search-criteria.js";

/** Dados de uma pesquisa de jogos, sem as dependências de infraestrutura. */
export type ResearchGamesRequest = {
	gameNames: string[];
	/** Critérios já resolvidos (preset + sobrescritas da requisição). */
	criteria: SearchCriteria;
	/** Steam ID do Fornecedor, para vincular a Trade criada. */
	supplierSteamId?: string;
	/** Código da Lista de origem no SteamTrades. */
	listCode?: string;
	/** Nome da Trade que será criada no Sistema Estoque. */
	title?: string;
};

/**
 * Porta para executar o fluxo completo de pesquisa (popularidade + preço + Criar Trade).
 * Isola `EnqueueResearchGamesUseCase` da montagem concreta das dependências.
 */
export interface ResearchGamesRunner {
	run(request: ResearchGamesRequest): Promise<void>;
}
