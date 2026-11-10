import type { JobsOptions } from "bullmq";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * O pedaço da BullMQ que os adapters de fila usam. Estreito de propósito, como o
 * `RedisPriceCacheClient`: os testes passam dublês com estes métodos, sem Redis
 * de verdade, e uma mudança de API da BullMQ aparece aqui, num lugar só.
 *
 * Os nomes não falam de pesquisa: são os mesmos para qualquer fila — a da
 * pesquisa, a de webhooks e a `BullmqJobQueue` de `lists` e `suppliers`.
 */

/** Um job entregue ao processador. `data` é `unknown`: veio do Redis. */
export type BullmqJob = {
	id?: string;
	data: unknown;
	moveToDelayed(timestamp: number, token?: string): Promise<void>;
};

/** `token` é o lock do job — exigido para movê-lo enquanto ativo. */
export type BullmqJobProcessor = (
	job: BullmqJob,
	token?: string,
) => Promise<void>;

/**
 * Um job já guardado, lido pelo id. Só o que os adapters usam para reconhecer
 * um pedido repetido (`docs/adr/0010-webhook-do-resultado-da-pesquisa.md`).
 */
export type BullmqStoredJob = {
	getState(): Promise<string>;
	remove(): Promise<void>;
	retry(
		state: "completed" | "failed",
		options?: { resetAttemptsMade?: boolean; resetAttemptsStarted?: boolean },
	): Promise<void>;
};

export type BullmqQueueClient = {
	add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
	getJob(id: string): Promise<BullmqStoredJob | undefined>;
	close(): Promise<void>;
};

/**
 * O estado de um job resumido no que importa para um pedido repetido. Todo
 * estado que não é fim (`waiting`, `active`, `delayed`, `prioritized`…) é
 * `pending`; `unknown` é a BullMQ dizendo que o job não existe mais.
 */
export type BullmqRunState = "none" | "pending" | "completed" | "failed";

export const toRunState = (
	job: BullmqStoredJob | undefined,
	state: string | undefined,
): BullmqRunState => {
	if (!job || state === undefined || state === "unknown") return "none";
	if (state === "completed" || state === "failed") return state;
	return "pending";
};

/**
 * Lê o job e o estado dele, cada leitura com teto: quem chama está numa
 * requisição, e sem isso um Redis conectado e travado a deixaria pendurada.
 */
export const readRunState = async (
	queue: Pick<BullmqQueueClient, "getJob">,
	id: string,
	timeoutMs: number,
): Promise<{ job?: BullmqStoredJob; state: BullmqRunState }> => {
	const job = await withTimeout(queue.getJob(id), timeoutMs);
	if (!job) return { state: "none" };
	return {
		job,
		state: toRunState(job, await withTimeout(job.getState(), timeoutMs)),
	};
};

export type BullmqWorkerClient = {
	run(): Promise<void>;
	close(force?: boolean): Promise<void>;
};
