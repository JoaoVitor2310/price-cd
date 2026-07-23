import type { SupplierListRequest } from "@/schemas/list.schema.js";
import type { ListTopic } from "@/domain/lists/list-topic.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";

/**
 * Portas (interfaces): o caso de uso depende disso; a infraestrutura implementa.
 * Facilita trocar fetch por Puppeteer, banco real, SMTP real, etc.
 */
export interface ListTopicFetcher {
	fetchUserLists(idSteam: string): Promise<ListTopic[]>;
	fetchList(userListUrl: string): Promise<ListTopic>;
}

export interface InactiveListNotifier {
	notify(inactiveLists: string[]): Promise<void>;
}

/**
 * Porta para executar o fluxo principal das listas.
 */
export interface RunListsRunner {
	run(supplierListRequest: SupplierListRequest): Promise<void>;
}

/**
 * Porta para buscar popularidade e preços de jogos.
 * Isola RunListsUseCase da implementação concreta de SearchGamesUseCase.
 */
export interface GameSearcher {
	search(request: SearchGamesRequest): Promise<GameAnalysisResult>;
}
