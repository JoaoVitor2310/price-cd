import { type JobsOptions, Queue, Worker } from "bullmq";
import type {
	ResearchGamesRunner,
	ResearchJobRequest,
} from "@/application/games/ports/research-games-runner.port.js";
import {
	type PreviousResearchRun,
	type ResearchQueue,
	type ResearchQueueStatus,
	ResearchQueueUnavailableError,
} from "@/application/games/ports/research-queue.port.js";
import {
	type BullmqJob,
	type BullmqJobProcessor,
	type BullmqQueueClient,
	type BullmqWorkerClient,
	readRunState,
} from "@/infrastructure/background/bullmq-clients.js";
import { BullmqConnectionLog } from "@/infrastructure/background/bullmq-connection-log.js";
import {
	closeQueueAndConnections,
	createBullmqConnections,
} from "@/infrastructure/background/bullmq-connections.js";
import { bullmqResearchCheckpoint } from "@/infrastructure/background/bullmq-research-checkpoint.js";
import {
	LONG_JOB_COMMAND_TIMEOUT_MS,
	LONG_JOB_MAX_STALLED_COUNT,
	LONG_JOB_OPTIONS,
} from "@/infrastructure/background/long-job-policy.js";
import { RESEARCH_QUEUE_NAME } from "@/infrastructure/background/queue-names.js";
import {
	parseResearchJobPayload,
	readResearchCheckpoint,
	readResearchFailureTarget,
} from "@/infrastructure/background/research-job-payload.js";
import { ResumableBullmqWorker } from "@/infrastructure/background/resumable-bullmq-worker.js";
import { errorMessage } from "@/lib/error-message.js";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * A fila durável da pesquisa autenticada, sobre BullMQ.
 * Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Um objeto só é produtor (`enqueue`) e consumidor (o worker), porque os dois
 * existem no mesmo processo e o price-cd é instância única. O worker é que
 * chama o `ResearchGamesRunner` — o use case não sabe que a fila existe.
 *
 * Aqui fica só o que é da pesquisa. Cada parte que muda por outro motivo mora no
 * seu arquivo: o formato persistido do job (`research-job-payload.ts`), o
 * consumo com desligamento ordenado (`resumable-bullmq-worker.ts`), o log de
 * conexão (`bullmq-connection-log.ts`), a visão estreita da BullMQ
 * (`bullmq-clients.ts`) e as conexões ioredis (`bullmq-connections.ts`).
 */

export { RESEARCH_QUEUE_NAME } from "@/infrastructure/background/queue-names.js";

const RESEARCH_JOB_NAME = "research";

/**
 * As tentativas da pesquisa: a primeira e mais três, esperando 30s, 1min e 2min.
 * Só o pedido que o runner diz que pode repetir (`canRetry`: idempotente no
 * Estoque e falha passageira) usa as outras — os demais são descartados na
 * primeira falha (`job.discard()`), porque repeti-los criaria outra Trade.
 * Cobre o Estoque fora por alguns minutos, a janela mais comum.
 */
export const RESEARCH_JOB_ATTEMPTS = 4;
export const RESEARCH_RETRY_BACKOFF = {
	type: "exponential",
	delay: 30_000,
} as const;

export const RESEARCH_JOB_OPTIONS: JobsOptions = {
	...LONG_JOB_OPTIONS,
	attempts: RESEARCH_JOB_ATTEMPTS,
	backoff: RESEARCH_RETRY_BACKOFF,
};

/** Ping do health: Redis lento conta como fora. */
const STATUS_TIMEOUT_MS = 1000;

export type BullmqResearchQueueDeps = {
	queue: BullmqQueueClient;
	createWorker: (processor: BullmqJobProcessor) => BullmqWorkerClient;
	ping: () => Promise<unknown>;
	/**
	 * Se a conexão do produtor está pronta. Necessário porque o `add` da BullMQ
	 * **espera** a conexão ficar pronta, mesmo com a fila offline desligada — com
	 * o Redis fora, a requisição ficaria pendurada (medido).
	 */
	isConnected: () => boolean;
	/** Fecha as conexões criadas por fora — a BullMQ não fecha conexão que recebeu pronta. */
	disconnect: () => Promise<void>;
};

export class BullmqResearchQueue implements ResearchQueue {
	private readonly jobs: ResumableBullmqWorker;
	private readonly connection = new BullmqConnectionLog({
		connected: "📥 [QUEUE] Redis connected — research queue on.",
		back: "📥 [QUEUE] Redis is responding again — research queue back on.",
		down: (operation, reason) =>
			`⚠️ [QUEUE] Redis ${operation} failed (${reason}) — new research requests are refused until it responds.`,
	});

	constructor(
		private readonly deps: BullmqResearchQueueDeps,
		private readonly runner: ResearchGamesRunner,
	) {
		// O desligamento ordenado (devolver o job ativo, `DelayedError`) é o do
		// `ResumableBullmqWorker`; aqui fica só o que o job significa.
		this.jobs = new ResumableBullmqWorker({
			label: "research",
			tag: "[QUEUE]",
			icon: "📥",
			createWorker: deps.createWorker,
			handle: (job, signal) => this.handle(job, signal),
		});
	}

	/**
	 * Sem try/catch: a falha chega a quem está na requisição, que recebe um erro
	 * em vez de um `202`.
	 *
	 * O timeout tem um custo conhecido: se o `add` passar do teto e o Redis o
	 * gravar depois, o cliente recebe erro por um pedido que vai rodar. Só
	 * acontece com o Redis conectado e travado; com `requestUuid`, o reenvio é
	 * seguro — ele é o `jobId`, e a BullMQ ignora um segundo `add` com o mesmo id
	 * enquanto o primeiro job existir.
	 */
	async enqueue(request: ResearchJobRequest): Promise<void> {
		this.assertConnected();
		const options: JobsOptions = request.requestUuid
			? { ...RESEARCH_JOB_OPTIONS, jobId: request.requestUuid }
			: RESEARCH_JOB_OPTIONS;
		await withTimeout(
			this.deps.queue.add(RESEARCH_JOB_NAME, request, options),
			LONG_JOB_COMMAND_TIMEOUT_MS,
		);
	}

	/**
	 * Mesma recusa do `enqueue` com o Redis fora: ler o job também esperaria a
	 * conexão, e quem chama ainda está na requisição.
	 */
	async previousRun(requestUuid: string): Promise<PreviousResearchRun> {
		this.assertConnected();
		const { state } = await readRunState(
			this.deps.queue,
			requestUuid,
			LONG_JOB_COMMAND_TIMEOUT_MS,
		);
		return state;
	}

	/** Só apaga job terminado: um em andamento continua e vai avisar. */
	async forget(requestUuid: string): Promise<void> {
		this.assertConnected();
		const { job, state } = await readRunState(
			this.deps.queue,
			requestUuid,
			LONG_JOB_COMMAND_TIMEOUT_MS,
		);
		if (job && (state === "completed" || state === "failed")) {
			await withTimeout(job.remove(), LONG_JOB_COMMAND_TIMEOUT_MS);
		}
	}

	private assertConnected(): void {
		if (!this.deps.isConnected()) {
			const error = new ResearchQueueUnavailableError("Redis is not connected");
			this.reportDown("enqueue", error);
			throw error;
		}
	}

	async status(): Promise<ResearchQueueStatus> {
		try {
			await withTimeout(this.deps.ping(), STATUS_TIMEOUT_MS);
			this.reportUp();
			return "up";
		} catch (error) {
			this.reportDown("ping", error);
			return "down";
		}
	}

	onApplicationBootstrap(): void {
		this.jobs.start();
	}

	/**
	 * Devolve o job em andamento à fila, fecha o worker sem esperar e espera os
	 * avisos de `failed` ainda sendo guardados (`ResumableBullmqWorker.stop`).
	 *
	 * Para a pesquisa, o efeito irrepetível é chamar o Estoque: o `AbortSignal`
	 * faz o `CreateResearchTrade` parar antes. Se o Estoque já estava sendo
	 * chamado quando o sinal veio, a Trade nasce e o job roda de novo — janela
	 * que só a idempotência do Estoque fecha (ADR 0010).
	 *
	 * O produtor da fila de webhooks só fecha no `onApplicationShutdown`, então o
	 * aviso ainda tem por onde sair enquanto este hook espera.
	 */
	beforeApplicationShutdown(): Promise<void> {
		return this.jobs.stop();
	}

	onApplicationShutdown(): Promise<void> {
		return closeQueueAndConnections(this.deps.queue, this.deps.disconnect);
	}

	/**
	 * Roda o pedido e, se falhar, decide se a BullMQ pode tentar de novo: só se o
	 * runner disser que repetir é seguro (`canRetry`). Senão o job é descartado,
	 * e a falha é definitiva já na primeira vez.
	 *
	 * Falha com o sinal abortado é do desligamento: o `ResumableBullmqWorker` a
	 * traduz em `DelayedError`, que não é tentativa — não há o que decidir aqui.
	 */
	private async handle(job: BullmqJob, signal: AbortSignal): Promise<void> {
		let request: ResearchJobRequest;
		try {
			request = parseResearchJobPayload(job.data);
		} catch (error) {
			// Ilegível hoje, ilegível na próxima tentativa.
			job.discard();
			throw error;
		}

		try {
			await this.runner.run(request, signal, bullmqResearchCheckpoint(job));
		} catch (error) {
			if (!signal.aborted && !this.runner.canRetry(request, error)) {
				job.discard();
			}
			throw error;
		}
	}

	/**
	 * Chamado pelo evento `failed` do worker, que a BullMQ emite **depois** de mover
	 * o job para falho, em toda falha: erro do runner, payload ilegível, limite de
	 * travamentos. É aqui, e não no runner, para cobrir as que não passam por ele e
	 * para um reenvio motivado pelo aviso já ver o job como `failed`.
	 *
	 * O evento também dispara numa tentativa que vai se repetir: só a falha
	 * **definitiva** (`finishedOn` preenchido) é avisada. Avisar antes ocuparia o
	 * `jobId` da fila de webhooks com um `failed`, e o `trade_created` da
	 * tentativa que desse certo seria ignorado. `DelayedError` (o desligamento)
	 * não emite o evento.
	 *
	 * Nunca lança: é ouvinte de evento. O notifier já tenta de novo por alguns
	 * segundos; não conseguir mesmo assim fica no log, e quem pediu cai no alarme
	 * dele — o reenvio roda o pedido de novo. O desligamento espera o aviso
	 * (`trackUntilShutdown`).
	 */
	onJobFailed(
		job: Pick<BullmqJob, "data" | "id" | "finishedOn"> | undefined,
		error: unknown,
	): Promise<void> {
		if (!job) return Promise.resolve();
		if (job.finishedOn === undefined) {
			console.warn(
				`🔁 [QUEUE] Research job ${job.id} failed (${errorMessage(error)}) — it will be tried again.`,
			);
			return Promise.resolve();
		}
		return this.jobs.trackUntilShutdown(this.reportFailure(job, error));
	}

	private async reportFailure(
		job: Pick<BullmqJob, "data" | "id">,
		error: unknown,
	): Promise<void> {
		try {
			// O desfecho guardado pelo checkpoint: se o Estoque já respondeu, a
			// falha foi só de avisar, e quem pediu recebe o desfecho.
			await this.runner.reportFailure(
				readResearchFailureTarget(job.data, job.id),
				error,
				readResearchCheckpoint(job.data).outcome,
			);
		} catch (reportError) {
			console.error(
				`❌ [QUEUE] Could not report the failed research job ${job.id}:`,
				reportError,
			);
		}
	}

	/** Públicos para os eventos de conexão (`createBullmqResearchQueue`). */
	reportUp(): void {
		this.connection.up();
	}

	reportDown(operation: string, error: unknown): void {
		this.connection.down(operation, error);
	}
}

/**
 * Cria as conexões, a fila e o worker. **Não espera a conexão**: o boot não
 * depende do Redis. Com ele fora, `enqueue` falha e o health mostra
 * `queue: "down"`; o worker começa a consumir quando a conexão sair.
 */
export const createBullmqResearchQueue = (
	url: string,
	runner: ResearchGamesRunner,
): BullmqResearchQueue => {
	// O adapter nasce depois das conexões e o worker nasce dentro do construtor
	// dele — por isso os listeners leem `researchQueue` na hora do evento.
	const report = {
		up: () => researchQueue.reportUp(),
		down: (operation: string, error: unknown) =>
			researchQueue.reportDown(operation, error),
	};

	const connections = createBullmqConnections(url, report);
	const queue = new Queue(RESEARCH_QUEUE_NAME, {
		connection: connections.producer,
	});
	queue.on("error", (error) => report.down("queue", error));

	const researchQueue: BullmqResearchQueue = new BullmqResearchQueue(
		{
			queue,
			ping: connections.ping,
			isConnected: connections.isProducerReady,
			createWorker: (processor) => {
				const worker = new Worker(RESEARCH_QUEUE_NAME, processor, {
					connection: connections.worker,
					concurrency: 1,
					autorun: false,
					// Passado o limite, o job falha pelo evento `failed`, como as
					// outras falhas (`onJobFailed`).
					maxStalledCount: LONG_JOB_MAX_STALLED_COUNT,
				});
				worker.on("error", (error) => report.down("worker", error));
				worker.on("completed", (job) =>
					console.log(`✅ [QUEUE] Research job ${job.id} completed.`),
				);
				worker.on("failed", (job, error) => {
					// Só a definitiva é erro; a que vai se repetir é logada pelo `onJobFailed`.
					if (job?.finishedOn !== undefined) {
						console.error(`❌ [QUEUE] Research job ${job.id} failed:`, error);
					}
					void researchQueue.onJobFailed(job, error);
				});
				return worker;
			},
			disconnect: connections.disconnect,
		},
		runner,
	);

	return researchQueue;
};
