import type { SupplierListRequest } from "@/schemas/list.schema.js";
import type { ListTopic } from "@/domain/lists/list-topic.js";
import type { FoundGames, SearchGamesRequest } from "@/application/games/game.types.js";

/**
 * Portas (interfaces): o caso de uso depende disso; a infraestrutura implementa.
 * Facilita trocar fetch por Puppeteer, banco real, SMTP real, etc.
 */
export interface ListTopicFetcher {
	fetchUserLists(idSteam: string): Promise<ListTopic[]>;
	fetchList(userListUrl: string): Promise<ListTopic>;
}

/**
 * Cria um `ListTopicFetcher` **por execução**.
 *
 * É fábrica, e não o fetcher direto, porque cada execução é dona de uma sessão
 * de browser e a descarta no `finally` (`disposeIfPresent`). Injetar a
 * instância faria todas as execuções compartilharem a mesma sessão — e a
 * primeira a terminar fecharia o browser das outras.
 *
 * É a distinção entre **dispose por execução** e ciclo de vida do container:
 * `OnModuleDestroy` serve ao que vive enquanto o app vive; isto aqui não vive.
 */
export abstract class ListTopicFetcherFactory {
	abstract create(): ListTopicFetcher;
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
 *
 * Contrato: o resultado já vem cortado pelas regras de domínio do catálogo —
 * popularidade mínima, jogos excluídos e Preço mínimo negociável (`partitionByPrice`).
 * Quem consome não repete esses filtros; quem implementa precisa aplicá-los.
 */
export abstract class GameSearcher {
	/**
	 * Devolve **só os jogos** precificados.
	 *
	 * Devolvia `GameAnalysisResult` — que carrega um `summary` com contagens e
	 * tempo de processamento existentes apenas para a resposta de
	 * `POST /api/games/search`. Nenhum consumidor desta porta jamais leu esse
	 * campo: `lists` e `suppliers` acessavam `.games` e descartavam o resto. O
	 * contrato compartilhado tinha a forma da apresentação de um terceiro.
	 */
	abstract search(request: SearchGamesRequest): Promise<FoundGames[]>;
}
