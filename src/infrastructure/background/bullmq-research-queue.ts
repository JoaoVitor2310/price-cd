import { DelayedError, type JobsOptions, Queue, Worker } from "bullmq";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";
import {
	type ResearchQueue,
	type ResearchQueueStatus,
	ResearchQueueUnavailableError,
} from "@/application/games/ports/research-queue.port.js";
import type {
	BullmqJob,
	BullmqJobProcessor,
	BullmqQueueClient,
	BullmqWorkerClient,
} from "@/infrastructure/background/bullmq-clients.js";
import { createBullmqConnections } from "@/infrastructure/background/bullmq-connections.js";
import { parseResearchJobPayload } from "@/infrastructure/background/research-job-payload.js";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * A fila durável da pesquisa autenticada, sobre BullMQ.
 * Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Um objeto só é produtor (`enqueue`) e consumidor (o worker), porque os dois
 * existem no mesmo processo e o price-cd é instância única. O worker é que
 * chama o `ResearchGamesRunner` — o use case não sabe que a fila existe.
 *
 * Aqui fica só o comportamento da fila. Cada parte que muda por outro motivo
 * mora no seu arquivo: o formato persistido do job (`research-job-payload.ts`),
 * a visão estreita da BullMQ (`bullmq-clients.ts`) e as conexões ioredis
 * (`bullmq-connections.ts`).
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
 * vez de entrar em loop derrubando o processo de novo.
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
	private readonly worker: BullmqWorkerClient;
	private active:
		| { job: BullmqJob; token?: string; returned: boolean }
		| undefined;
	private shuttingDown = false;
	/**
	 * `unknown` até a primeira conexão: um ping ou `enqueue` antes dela não é
	 * queda — só um erro de **conexão** avisa nesse estado. Sem isso, o primeiro
	 * health do boot logava "ping failed" seguido de "responding again".
	 */
	private connection: "unknown" | "up" | "down" = "unknown";

	constructor(
		private readonly deps: BullmqResearchQueueDeps,
		private readonly runner: ResearchGamesRunner,
	) {
		this.worker = deps.createWorker((job, token) => this.process(job, token));
	}

	/**
	 * Sem try/catch: a falha chega a quem está na requisição, que recebe um erro
	 * em vez de um `202`.
	 *
	 * O timeout tem um custo conhecido: se o `add` passar do teto e o Redis o
	 * gravar depois, o cliente recebe erro por um pedido que vai rodar. Só
	 * acontece com o Redis conectado e travado; a idempotência pelo
	 * `request_uuid` (PR 2 da integração com o chatbot) torna o reenvio seguro.
	 */
	async enqueue(request: ResearchGamesRequest): Promise<void> {
		if (!this.deps.isConnected()) {
			const error = new ResearchQueueUnavailableError("Redis is not connected");
			this.reportDown("enqueue", error);
			throw error;
		}
		await withTimeout(
			this.deps.queue.add(RESEARCH_JOB_NAME, request, RESEARCH_JOB_OPTIONS),
			ENQUEUE_TIMEOUT_MS,
		);
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

	/**
	 * Começa a consumir só quando o container inteiro está de pé (o Nest chama
	 * o hook em todo provider que o tem): um job que começasse antes pegaria
	 * dependências ainda não inicializadas.
	 */
	onApplicationBootstrap(): void {
		this.worker.run().catch((error) => {
			console.error("❌ [QUEUE] Research worker stopped:", error);
		});
	}

	/**
	 * Para de consumir **antes** de os browsers fecharem: o Nest chama todos os
	 * `beforeApplicationShutdown` antes de qualquer `onApplicationShutdown`, que
	 * é onde o `BrowserShutdown` fecha o Chromium.
	 *
	 * O job em andamento volta para a fila (`moveToDelayed` com delay zero), sem
	 * consumir tentativa, e roda inteiro de novo quando o serviço subir. Uma
	 * pesquisa leva minutos e o `stop_grace_period` não espera isso. Se a
	 * devolução falhar (Redis fora), o lock do job expira e o próximo worker o
	 * recupera como travado — mais lento, mesmo resultado.
	 *
	 * `close(true)` não espera o processador terminar: ele segue até o browser
	 * fechar e falha, e o `process` traduz essa falha em `DelayedError` para a
	 * BullMQ não marcar o job como falho.
	 */
	async beforeApplicationShutdown(): Promise<void> {
		this.shuttingDown = true;

		const active = this.active;
		if (active) {
			try {
				await active.job.moveToDelayed(Date.now(), active.token);
				active.returned = true;
				console.log(
					`📥 [QUEUE] Research job ${active.job.id} returned to the queue — it runs again on the next boot.`,
				);
			} catch (error) {
				console.warn(
					`⚠️ [QUEUE] Could not return research job ${active.job.id} to the queue (${errorMessage(error)}) — it will be recovered as stalled.`,
				);
			}
		}

		try {
			await this.worker.close(true);
		} catch (error) {
			console.warn(
				`⚠️ [QUEUE] Failed to close the research worker: ${errorMessage(error)}`,
			);
		}
	}

	async onApplicationShutdown(): Promise<void> {
		try {
			await this.deps.queue.close();
		} catch {
			// Já fechada ou Redis fora — nada a liberar.
		}
		await this.deps.disconnect().catch(() => undefined);
	}

	private async process(job: BullmqJob, token?: string): Promise<void> {
		// Pego no instante do desligamento — entre o `shuttingDown = true` e o
		// `close(true)` o worker ainda busca job. Rodar seria começar uma pesquisa
		// que o browser fechando vai derrubar; devolve na hora, sem consumir
		// tentativa. Se a devolução falhar, `DelayedError` deixa o job ativo e ele
		// volta como travado.
		if (this.shuttingDown) {
			await job
				.moveToDelayed(Date.now(), token)
				.catch((error) =>
					console.warn(
						`⚠️ [QUEUE] Could not return research job ${job.id} picked during shutdown (${errorMessage(error)}) — it will be recovered as stalled.`,
					),
				);
			throw new DelayedError();
		}

		const request = parseResearchJobPayload(job.data);
		const active = { job, token, returned: false };
		this.active = active;

		let outcome: { ok: true } | { ok: false; error: unknown };
		try {
			await this.runner.run(request);
			outcome = { ok: true };
		} catch (error) {
			outcome = { ok: false, error };
		} finally {
			this.active = undefined;
		}

		if (outcome.ok) {
			if (!active.returned) return;
			// Terminou depois de ter sido devolvido à fila: vai rodar de novo. Só
			// a idempotência do Estoque impede uma Trade repetida aqui
			// (`docs/INTEGRACAO_CHATBOT.md`, divergência 2). `DelayedError` diz à
			// BullMQ que o job já foi movido e não deve ser tocado.
			console.warn(
				`⚠️ [QUEUE] Research job ${job.id} finished during shutdown, after being returned to the queue — it will run again.`,
			);
			throw new DelayedError();
		}

		// Durante o desligamento a falha é do próprio desligamento (browser
		// fechado), não do pedido: devolvido, o job fica onde está; não
		// devolvido, fica ativo e volta como travado. Os dois rodam de novo.
		if (this.shuttingDown) throw new DelayedError();
		throw outcome.error;
	}

	/** Públicos para os eventos de conexão (`createBullmqResearchQueue`). */
	reportUp(): void {
		if (this.connection === "up") return;
		const previous = this.connection;
		this.connection = "up";
		console.log(
			previous === "unknown"
				? "📥 [QUEUE] Redis connected — research queue on."
				: "📥 [QUEUE] Redis is responding again — research queue back on.",
		);
	}

	reportDown(operation: string, error: unknown): void {
		if (this.connection === "down") return;
		// Antes da primeira conexão, ping e `enqueue` falham só por ela ainda não
		// ter saído. Se o Redis estiver mesmo fora, o erro de conexão avisa.
		if (this.connection === "unknown" && operation !== "connection") return;
		this.connection = "down";
		console.warn(
			`⚠️ [QUEUE] Redis ${operation} failed (${errorMessage(error)}) — new research requests are refused until it responds.`,
		);
	}
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

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
				worker.on("failed", (job, error) =>
					console.error(`❌ [QUEUE] Research job ${job?.id} failed:`, error),
				);
				return worker;
			},
			disconnect: connections.disconnect,
		},
		runner,
	);

	return researchQueue;
};
