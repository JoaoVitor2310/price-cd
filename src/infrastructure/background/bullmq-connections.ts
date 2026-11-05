import { Redis } from "ioredis";

/**
 * As conexões ioredis de uma fila BullMQ. Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Duas conexões, com papéis diferentes:
 * - a do **produtor** tem a fila offline desligada, e quem enfileira confere
 *   `isProducerReady()` antes do `add`: com o Redis fora, a requisição recebe o
 *   erro na hora, em vez de ficar pendurada (o `add` da BullMQ espera a conexão
 *   mesmo sem fila offline — medido);
 * - a do **worker** tem `maxRetriesPerRequest: null`, que a BullMQ exige para os
 *   comandos bloqueantes, e espera o Redis voltar.
 *
 * **Não espera a conexão:** o boot não depende do Redis.
 */

/**
 * Espera entre tentativas de reconexão, dobrando até um teto. O teto é curto
 * para o produtor: enquanto ele não reconecta, a pesquisa é recusada com 500 —
 * com 30s, o Redis voltava e o price-cd seguia recusando por até meio minuto.
 * O worker pode esperar mais: o atraso dele só adia o consumo, ninguém está na
 * requisição.
 */
export const reconnectStrategy =
	(ceilingMs: number) =>
	(retries: number): number =>
		Math.min(500 * 2 ** retries, ceilingMs);

export const PRODUCER_RECONNECT_CEILING_MS = 5_000;
export const WORKER_RECONNECT_CEILING_MS = 30_000;

const CONNECT_TIMEOUT_MS = 2000;

/** Quem quer saber de queda e volta do Redis (o adapter, para logar e o health). */
export type ConnectionEvents = {
	up(): void;
	down(operation: string, error: unknown): void;
};

export type BullmqConnections = {
	/** Para a `Queue` da BullMQ (quem enfileira). */
	producer: Redis;
	/** Para o `Worker` da BullMQ (quem consome). */
	worker: Redis;
	isProducerReady(): boolean;
	ping(): Promise<unknown>;
	/** A BullMQ não fecha conexão que recebeu pronta: quem criou fecha. */
	disconnect(): Promise<void>;
};

/**
 * Os listeners de `error` são obrigatórios: sem eles o `EventEmitter` lança e
 * derruba o processo na primeira queda do Redis.
 */
export const createBullmqConnections = (
	url: string,
	events: ConnectionEvents,
): BullmqConnections => {
	const producer = new Redis(url, {
		enableOfflineQueue: false,
		connectTimeout: CONNECT_TIMEOUT_MS,
		retryStrategy: reconnectStrategy(PRODUCER_RECONNECT_CEILING_MS),
	});
	const worker = new Redis(url, {
		maxRetriesPerRequest: null,
		connectTimeout: CONNECT_TIMEOUT_MS,
		retryStrategy: reconnectStrategy(WORKER_RECONNECT_CEILING_MS),
	});

	for (const connection of [producer, worker]) {
		connection.on("error", (error) => events.down("connection", error));
		connection.on("ready", () => events.up());
	}

	return {
		producer,
		worker,
		isProducerReady: () => producer.status === "ready",
		ping: () => producer.ping(),
		disconnect: async () => {
			producer.disconnect();
			worker.disconnect();
		},
	};
};
