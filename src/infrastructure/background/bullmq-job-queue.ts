import { type JobsOptions, Queue, Worker } from "bullmq";
import {
	type BullmqJobProcessor,
	type BullmqQueueClient,
	type BullmqWorkerClient,
} from "@/infrastructure/background/bullmq-clients.js";
import { BullmqConnectionLog } from "@/infrastructure/background/bullmq-connection-log.js";
import {
	closeQueueAndConnections,
	createBullmqConnections,
} from "@/infrastructure/background/bullmq-connections.js";
import {
	LONG_JOB_COMMAND_TIMEOUT_MS,
	LONG_JOB_MAX_STALLED_COUNT,
	LONG_JOB_OPTIONS,
} from "@/infrastructure/background/long-job-policy.js";
import { ResumableBullmqWorker } from "@/infrastructure/background/resumable-bullmq-worker.js";
import { capitalize } from "@/lib/capitalize.js";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * Uma fila durável de jobs longos que só precisam ser guardados e executados: o
 * Reabastecimento (`lists`) e a Descoberta de Fornecedores (`suppliers`). Ver
 * `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Genérica no pedido (`T`): o mesmo objeto satisfaz `ListsRunQueue` e
 * `SupplierDiscoveryQueue`, que só pedem `enqueue`. É também o provider do Nest,
 * por isso os hooks de ciclo de vida estão aqui — o Nest só os chama em provider.
 *
 * A fila da pesquisa **não** é esta: ela tem o que estas não têm — pedido repetido
 * por `requestUuid`, aviso de `failed` a quem pediu, o estado para o health. As
 * duas compõem as mesmas peças (`ResumableBullmqWorker`, `BullmqConnectionLog`,
 * `closeQueueAndConnections`), e o desligamento ordenado existe num lugar só.
 */

export type BullmqJobQueueDeps = {
	queue: Pick<BullmqQueueClient, "add" | "close">;
	createWorker: (processor: BullmqJobProcessor) => BullmqWorkerClient;
	/** Ver `BullmqResearchQueueDeps.isConnected`: o `add` esperaria a conexão. */
	isConnected: () => boolean;
	disconnect: () => Promise<void>;
};

export type BullmqJobQueueOptions<T> = {
	/** Nome da fila nos logs, em minúsculas: "lists". */
	label: string;
	/** Prefixo dos logs, como `[LISTS]`. */
	tag: string;
	icon: string;
	jobName: string;
	/**
	 * Junta os pedidos repetidos num só **enquanto um job espera ou roda**
	 * (`deduplication` da BullMQ, sem `ttl`): um `enqueue` com outro job dessa
	 * fila ainda vivo é ignorado. Terminado (concluído ou falho), o próximo pedido
	 * cria um job novo, e o registro das execuções fica intacto — o que um `jobId`
	 * fixo não permitiria, porque a BullMQ ignora o `add` enquanto o job existir.
	 *
	 * Só para a fila cujo pedido não tem parâmetro (a Descoberta): dois
	 * Reabastecimentos de fornecedores diferentes são pedidos diferentes.
	 */
	deduplicationId?: string;
	/**
	 * Lê o que voltou do Redis. Pode ter sido gravado por outra versão do código:
	 * lança com mensagem legível, e o job falha em vez de chegar torto ao use case.
	 */
	parse: (data: unknown) => T;
	run: (request: T, signal: AbortSignal) => Promise<void>;
};

export class BullmqJobQueue<T> {
	private readonly jobs: ResumableBullmqWorker;
	private readonly connection: BullmqConnectionLog;

	constructor(
		private readonly deps: BullmqJobQueueDeps,
		private readonly options: BullmqJobQueueOptions<T>,
	) {
		const { label, tag, icon } = options;
		// Sem frase na primeira conexão: o Redis é o da pesquisa, que já a loga.
		this.connection = new BullmqConnectionLog({
			back: `${icon} ${tag} Redis is responding again — ${label} queue back on.`,
			down: (operation, reason) =>
				`⚠️ ${tag} Redis ${operation} failed (${reason}) — new ${label} requests are refused until it responds.`,
		});
		this.jobs = new ResumableBullmqWorker({
			label,
			tag,
			icon,
			createWorker: deps.createWorker,
			handle: (job, signal) => options.run(options.parse(job.data), signal),
		});
	}

	/**
	 * Sem try/catch: a falha chega a quem está na requisição, que recebe um erro
	 * em vez de um `202`. Como na pesquisa, se o `add` passar do teto e o Redis o
	 * gravar depois, o pedido roda mesmo tendo recebido erro — só com o Redis
	 * conectado e travado.
	 */
	async enqueue(request: T): Promise<void> {
		if (!this.deps.isConnected()) {
			const error = new Error(
				`${capitalize(this.options.label)} queue unavailable: Redis is not connected`,
			);
			this.reportDown("enqueue", error);
			throw error;
		}
		const { deduplicationId } = this.options;
		const options: JobsOptions = deduplicationId
			? { ...LONG_JOB_OPTIONS, deduplication: { id: deduplicationId } }
			: LONG_JOB_OPTIONS;
		await withTimeout(
			this.deps.queue.add(this.options.jobName, request, options),
			LONG_JOB_COMMAND_TIMEOUT_MS,
		);
	}

	onApplicationBootstrap(): void {
		this.jobs.start();
	}

	/** Devolve os jobs em andamento à fila antes de os browsers fecharem. */
	beforeApplicationShutdown(): Promise<void> {
		return this.jobs.stop();
	}

	onApplicationShutdown(): Promise<void> {
		return closeQueueAndConnections(this.deps.queue, this.deps.disconnect);
	}

	/** Públicos para os eventos de conexão (`createBullmqJobQueue`). */
	reportUp(): void {
		this.connection.up();
	}

	reportDown(operation: string, error: unknown): void {
		this.connection.down(operation, error);
	}
}

/**
 * Cria conexões, fila e worker. Como a da pesquisa, **não espera a conexão**: o
 * boot não depende do Redis. Cada fila tem as próprias conexões — um comando
 * bloqueante do worker de uma não pode segurar o de outra.
 */
export const createBullmqJobQueue = <T>(
	url: string,
	options: BullmqJobQueueOptions<T> & {
		queueName: string;
		concurrency: number;
	},
): BullmqJobQueue<T> => {
	const { queueName, concurrency, label, tag } = options;
	// O adapter nasce depois das conexões e o worker dentro do construtor dele —
	// por isso os listeners leem `jobQueue` na hora do evento.
	const connections = createBullmqConnections(url, {
		up: () => jobQueue.reportUp(),
		down: (operation, error) => jobQueue.reportDown(operation, error),
	});
	const queue = new Queue(queueName, { connection: connections.producer });
	queue.on("error", (error) => jobQueue.reportDown("queue", error));

	const jobQueue: BullmqJobQueue<T> = new BullmqJobQueue<T>(
		{
			queue,
			isConnected: connections.isProducerReady,
			disconnect: connections.disconnect,
			createWorker: (processor) => {
				const worker = new Worker(queueName, processor, {
					connection: connections.worker,
					concurrency,
					autorun: false,
					maxStalledCount: LONG_JOB_MAX_STALLED_COUNT,
				});
				worker.on("error", (error) => jobQueue.reportDown("worker", error));
				worker.on("completed", (job) =>
					console.log(
						`✅ ${tag} ${capitalize(label)} job ${job.id} completed.`,
					),
				);
				worker.on("failed", (job, error) =>
					console.error(
						`❌ ${tag} ${capitalize(label)} job ${job?.id} failed:`,
						error,
					),
				);
				return worker;
			},
		},
		options,
	);

	return jobQueue;
};
