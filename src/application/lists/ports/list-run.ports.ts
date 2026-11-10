import type { SupplierListRequest } from "@/schemas/list.schema.js";
import type { ListTopic } from "@/domain/lists/list-topic.js";
import type { FoundGames, SearchGamesRequest } from "@/application/games/game.types.js";
import type { CancellationSignal } from "@/application/shared/cancellation.js";

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
 * Porta para executar o fluxo principal das listas. É o que a `ListsRunQueue`
 * executa ao consumir um pedido.
 *
 * `signal` é a fila avisando que o pedido foi **devolvido** a ela (desligamento
 * do serviço) e vai rodar de novo: `run` para antes de criar a Trade.
 */
export interface RunListsRunner {
	run(
		supplierListRequest: SupplierListRequest,
		signal?: CancellationSignal,
	): Promise<void>;
}

/**
 * Porta para buscar popularidade e preços de jogos.
 * Isola RunListsUseCase do motor de precificação (`PriceGames`).
 *
 * Contrato: o resultado já vem cortado pelas regras de domínio do catálogo —
 * popularidade mínima, jogos excluídos e Preço mínimo negociável (`partitionByPrice`).
 * Quem consome não repete esses filtros; quem implementa precisa aplicá-los.
 */
export abstract class GameSearcher {
	/** Devolve **só os jogos** precificados, já cortados pelos critérios. */
	abstract search(request: SearchGamesRequest): Promise<FoundGames[]>;
}
