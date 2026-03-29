import type { VipListRequest } from "@/schemas/list.schema.js";
import type { ListTopic } from "@/domain/lists/list-topic.js";
import type { RunListsServiceResult } from "@/services/lists/run-lists.service.js";
import type { GameAnalysisResult } from "@/types/games";

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

export interface ListResultFormatter {
	formatListResult(gamePrices: GameAnalysisResult, id_steam: string): string;
}

export type RunListsCallbackStatus = "completed" | "failed";

export type RunListsCallbackPayload = {
	status: RunListsCallbackStatus;
	result: string;
};

/**
 * Porta para postar o callback (infra: HTTP client).
 */
export interface RunListsCallbackPoster {
	postCallback(
		callbackUrl: string,
		payload: RunListsCallbackPayload,
	): Promise<void>;
}

/**
 * Porta para agendar execução em background no mesmo processo.
 * (infra simples: setImmediate; futuro: fila/worker)
 */
export interface BackgroundScheduler {
	schedule(task: () => Promise<void>): void;
}

/**
 * Porta para executar o fluxo principal das listas.
 * (adapter: chama runListsService ou RunListsUseCase com portas)
 */
export interface RunListsRunner {
	run(vipListRequest: VipListRequest): Promise<RunListsServiceResult>;
}
