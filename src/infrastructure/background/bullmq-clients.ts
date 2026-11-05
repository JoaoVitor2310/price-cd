import type { JobsOptions } from "bullmq";

/**
 * O pedaço da BullMQ que os adapters de fila usam. Estreito de propósito, como o
 * `RedisPriceCacheClient`: os testes passam dublês com estes métodos, sem Redis
 * de verdade, e uma mudança de API da BullMQ aparece aqui, num lugar só.
 *
 * Os nomes não falam de pesquisa: são os mesmos para qualquer fila. É o que o
 * item 9 do `docs/IMPROVEMENTS.md` (`lists` e `suppliers` duráveis) reaproveita.
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

export type BullmqQueueClient = {
	add(name: string, data: unknown, options: JobsOptions): Promise<unknown>;
	close(): Promise<void>;
};

export type BullmqWorkerClient = {
	run(): Promise<void>;
	close(force?: boolean): Promise<void>;
};
