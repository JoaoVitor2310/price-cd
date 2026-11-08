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
import {
	parseResearchJobPayload,
	readResearchFailureTarget,
} from "@/infrastructure/background/research-job-payload.js";
import { ResumableBullmqWorker } from "@/infrastructure/background/resumable-bullmq-worker.js";
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

export const RESEARCH_QUEUE_NAME = "research";
const RESEARCH_JOB_NAME = "research";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * O registro das execuções: quanto tempo um job terminado fica no Redis para
 * ser consultado. Por idade, não por contagem — "o que rodou na última semana"
 * é a pergunta, e uma rajada de pedidos não deve apagar o histórico.
 *
 * `attempts` fica no default (1) de propósito: repetir uma pesquisa que falhou
 * depois de chamar o Estoque pode criar uma segunda Trade, e o Estoque ainda não
 * tem idempotência. Interrupção por deploy **não** é tentativa — o job volta à
 * fila sem consumir nada (ver `beforeApplicationShutdown`).
 */
export const RESEARCH_JOB_OPTIONS: JobsOptions = {
	removeOnComplete: { age: (7 * DAY_MS) / 1000 },
	removeOnFail: { age: (30 * DAY_MS) / 1000 },
};

/**
 * Um processo que morre no meio de um job (OOM, SIGKILL) deixa o job "travado";
 * o próximo worker o recoloca na fila. Depois de 2 travamentos, o job falha em
 * vez de entrar em loop derrubando o processo de novo: a BullMQ grava a falha no
 * job e o worker a aplica ao pegá-lo, sem chamar o processador. Passa pelo evento
 * `failed` como as outras (`onJobFailed`).
 */
export const RESEARCH_MAX_STALLED_COUNT = 2;

/** Ping do health: Redis lento conta como fora. */
const STATUS_TIMEOUT_MS = 1000;

/**
 * Teto para guardar um pedido com a conexão pronta. É rede de segurança, não o
 * caminho comum: o Redis fora é recusado antes, pelo `isConnected`.
 */
const ENQUEUE_TIMEOUT_MS = 5000;

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
			handle: (job, signal) =>
				this.runner.run(parseResearchJobPayload(job.data), signal),
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
			ENQUEUE_TIMEOUT_MS,
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
			ENQUEUE_TIMEOUT_MS,
		);
		return state;
	}

	/** Só apaga job terminado: um em andamento continua e vai avisar. */
	async forget(requestUuid: string): Promise<void> {
		this.assertConnected();
		const { job, state } = await readRunState(
			this.deps.queue,
			requestUuid,
			ENQUEUE_TIMEOUT_MS,
		);
		if (job && (state === "completed" || state === "failed")) {
			await withTimeout(job.remove(), ENQUEUE_TIMEOUT_MS);
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
	 * Chamado pelo evento `failed` do worker, que a BullMQ emite **depois** de mover
	 * o job para falho, em toda falha: erro do runner, payload ilegível, limite de
	 * travamentos. É aqui, e não no runner, para cobrir as que não passam por ele e
	 * para um reenvio motivado pelo aviso já ver o job como `failed`.
	 *
	 * `attempts` é 1, então todo `failed` é definitivo; `DelayedError` (o
	 * desligamento) não emite o evento.
	 *
	 * Nunca lança: é ouvinte de evento. O notifier já tenta de novo por alguns
	 * segundos; não conseguir mesmo assim fica no log, e quem pediu cai no alarme
	 * dele — o reenvio roda o pedido de novo. O desligamento espera o aviso
	 * (`trackUntilShutdown`).
	 */
	onJobFailed(
		job: Pick<BullmqJob, "data" | "id"> | undefined,
		error: unknown,
	): Promise<void> {
		if (!job) return Promise.resolve();
		return this.jobs.trackUntilShutdown(this.reportFailure(job, error));
	}

	private async reportFailure(
		job: Pick<BullmqJob, "data" | "id">,
		error: unknown,
	): Promise<void> {
		try {
			await this.runner.reportFailure(
				readResearchFailureTarget(job.data, job.id),
				error,
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
					maxStalledCount: RESEARCH_MAX_STALLED_COUNT,
				});
				worker.on("error", (error) => report.down("worker", error));
				worker.on("completed", (job) =>
					console.log(`✅ [QUEUE] Research job ${job.id} completed.`),
				);
				worker.on("failed", (job, error) => {
					console.error(`❌ [QUEUE] Research job ${job?.id} failed:`, error);
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
