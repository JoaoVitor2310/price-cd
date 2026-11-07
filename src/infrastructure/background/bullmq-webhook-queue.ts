import { setTimeout as sleep } from "node:timers/promises";
import { type JobsOptions, Queue, UnrecoverableError, Worker } from "bullmq";
import * as z from "zod";
import type {
	ResearchResult,
	ResearchResultNotifier,
	ResearchResultTarget,
} from "@/application/games/ports/research-result-notifier.port.js";
import {
	type BullmqJob,
	type BullmqJobProcessor,
	type BullmqQueueClient,
	type BullmqWorkerClient,
	readRunState,
} from "@/infrastructure/background/bullmq-clients.js";
import { createBullmqConnections } from "@/infrastructure/background/bullmq-connections.js";
import {
	type HttpWebhookSender,
	WebhookTargetNotAllowedError,
} from "@/infrastructure/webhooks/http-webhook-sender.js";
import {
	toWebhookBody,
	type WebhookBody,
} from "@/infrastructure/webhooks/webhook-body.js";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * A entrega do Resultado da pesquisa a quem pediu, como fila BullMQ própria.
 * Ver `docs/adr/0010-webhook-do-resultado-da-pesquisa.md`.
 *
 * Fila separada da pesquisa porque o ritmo é outro: entregar não usa navegador,
 * e um webhook esperando o chatbot voltar não pode segurar a próxima pesquisa.
 *
 * - **Um aviso por pedido:** `jobId = requestUuid`. Um segundo `add` com o mesmo
 *   id, enquanto o primeiro existe (até 7 dias depois de entregue), é ignorado
 *   pela BullMQ — quem pediu nunca recebe dois resultados diferentes.
 * - **Novas tentativas por ~24h**, com espera dobrando até 1h
 *   (`webhookRetryDelayMs`). Desistir é registrado no job falho.
 */

export const WEBHOOK_QUEUE_NAME = "webhooks";
const WEBHOOK_JOB_NAME = "research-result";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Espera antes da tentativa `attemptsMade + 1`: 30s, 1min, 2min… até 1h. */
export const webhookRetryDelayMs = (attemptsMade: number): number =>
	Math.min(30 * SECOND_MS * 2 ** Math.max(attemptsMade - 1, 0), HOUR_MS);

/**
 * 31 tentativas: 7 até a espera chegar a 1h (~64 min ao todo) e mais 23 de
 * hora em hora — a última sai ~24h depois da primeira. É o "até 24 horas" do
 * pedido do chatbot; o teste confere a soma.
 */
export const WEBHOOK_MAX_ATTEMPTS = 31;

export const WEBHOOK_JOB_OPTIONS: JobsOptions = {
	attempts: WEBHOOK_MAX_ATTEMPTS,
	backoff: { type: "custom" },
	removeOnComplete: { age: (7 * DAY_MS) / 1000 },
	removeOnFail: { age: (30 * DAY_MS) / 1000 },
};

/** Teto para guardar o aviso, pelo mesmo motivo do da fila da pesquisa. */
const NOTIFY_TIMEOUT_MS = 5000;

/**
 * Esperas entre as tentativas de guardar o aviso: ~15s ao todo, acima do teto de
 * 5s da reconexão do produtor (`bullmq-connections.ts`). Uma reinicialização do
 * Redis ou uma queda curta de rede não perde o aviso.
 */
export const NOTIFY_RETRY_DELAYS_MS: readonly number[] = [
	1000, 2000, 4000, 8000,
];

/**
 * Quanto o desligamento espera a entrega em andamento: o envio leva no máximo
 * 10s, com folga para registrar o desfecho. Sem o teto, o Redis fora travaria o
 * `close()` e, com ele, o fechamento do Chromium.
 */
const WORKER_CLOSE_TIMEOUT_MS = 15_000;

/** O que fica no Redis: para onde, e o corpo já no formato do fio. */
const webhookJobPayloadSchema = z.looseObject({
	url: z.string().min(1),
	body: z.looseObject({
		request_uuid: z.string().min(1),
		result: z.enum(["trade_created", "no_trade", "failed"]),
	}),
});

type WebhookJobPayload = { url: string; body: WebhookBody };

export type BullmqWebhookQueueDeps = {
	queue: BullmqQueueClient;
	createWorker: (processor: BullmqJobProcessor) => BullmqWorkerClient;
	isConnected: () => boolean;
	disconnect: () => Promise<void>;
	/** Para os testes; o default é `NOTIFY_RETRY_DELAYS_MS`. */
	notifyRetryDelaysMs?: readonly number[];
};

export class BullmqWebhookQueue implements ResearchResultNotifier {
	private readonly worker: BullmqWorkerClient;

	constructor(
		private readonly deps: BullmqWebhookQueueDeps,
		private readonly sender: Pick<HttpWebhookSender, "send">,
	) {
		this.worker = deps.createWorker((job) => this.process(job));
	}

	/**
	 * Tenta de novo enquanto o Redis não responde, por `NOTIFY_RETRY_DELAYS_MS`:
	 * um aviso perdido aqui é quem recebeu `202` sem resposta. Repetir o `add` é
	 * seguro, porque o `jobId` é o `requestUuid` e um segundo `add` é ignorado.
	 *
	 * Esgotadas as tentativas, lança. Com o resultado da pesquisa, o job falha e a
	 * fila da pesquisa tenta o `failed`; com o `failed`, o evento da fila só
	 * registra no log, e sobra o alarme de quem pediu.
	 */
	async notify(
		target: ResearchResultTarget,
		result: ResearchResult,
	): Promise<void> {
		const payload: WebhookJobPayload = {
			url: target.webhookUrl,
			body: toWebhookBody(target.requestUuid, result),
		};
		const delays = this.deps.notifyRetryDelaysMs ?? NOTIFY_RETRY_DELAYS_MS;

		for (let attempt = 0; ; attempt++) {
			try {
				this.assertConnected();
				await withTimeout(
					this.deps.queue.add(WEBHOOK_JOB_NAME, payload, {
						...WEBHOOK_JOB_OPTIONS,
						jobId: target.requestUuid,
					}),
					NOTIFY_TIMEOUT_MS,
				);
				return;
			} catch (error) {
				const delay = delays[attempt];
				if (delay === undefined) throw error;
				console.warn(
					`⚠️ [WEBHOOK] Could not store the result of request ${target.requestUuid} (${errorMessage(error)}) — trying again in ${delay}ms.`,
				);
				await sleep(delay);
			}
		}
	}

	/**
	 * O mesmo resultado, entregue de novo: o job guardado volta para a fila com
	 * as 31 tentativas zeradas. Um que ainda está tentando entregar segue como
	 * está — já vai chegar.
	 */
	async redeliver(requestUuid: string): Promise<boolean> {
		this.assertConnected();
		const { job, state } = await readRunState(
			this.deps.queue,
			requestUuid,
			NOTIFY_TIMEOUT_MS,
		);
		if (state === "none" || !job) return false;
		if (state === "completed" || state === "failed") {
			await withTimeout(
				job.retry(state, {
					resetAttemptsMade: true,
					resetAttemptsStarted: true,
				}),
				NOTIFY_TIMEOUT_MS,
			);
		}
		return true;
	}

	/**
	 * Apaga o aviso guardado, inclusive um que ainda está esperando a próxima
	 * tentativa. Um envio **neste instante** não dá para apagar (o job está
	 * travado pelo worker): lança, e quem reenviou recebe erro e tenta de novo.
	 * Seguir em frente faria o aviso novo ser ignorado pelo `jobId`.
	 */
	async forget(requestUuid: string): Promise<void> {
		this.assertConnected();
		const job = await withTimeout(
			this.deps.queue.getJob(requestUuid),
			NOTIFY_TIMEOUT_MS,
		);
		if (job) await withTimeout(job.remove(), NOTIFY_TIMEOUT_MS);
	}

	private assertConnected(): void {
		if (!this.deps.isConnected()) {
			throw new Error("Webhook queue unavailable: Redis is not connected");
		}
	}

	onApplicationBootstrap(): void {
		this.worker.run().catch((error) => {
			console.error("❌ [WEBHOOK] Worker stopped:", error);
		});
	}

	/**
	 * Fecha **esperando** a entrega em andamento, até `WORKER_CLOSE_TIMEOUT_MS`.
	 * Passando disso, fecha sem esperar: o job volta como travado e é entregue de
	 * novo — quem recebe é idempotente pelo `request_uuid`.
	 */
	async beforeApplicationShutdown(): Promise<void> {
		try {
			await withTimeout(this.worker.close(), WORKER_CLOSE_TIMEOUT_MS);
		} catch (error) {
			console.warn(
				`⚠️ [WEBHOOK] Failed to close the worker (${errorMessage(error)}) — closing without waiting.`,
			);
			await this.worker.close(true).catch(() => undefined);
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

	private async process(job: BullmqJob): Promise<void> {
		const parsed = webhookJobPayloadSchema.safeParse(job.data);
		if (!parsed.success) {
			throw new UnrecoverableError(
				`Invalid webhook job payload: ${parsed.error.message}`,
			);
		}
		const { url, body } = parsed.data as WebhookJobPayload;

		try {
			await this.sender.send(url, body);
		} catch (error) {
			if (error instanceof WebhookTargetNotAllowedError) {
				throw new UnrecoverableError(error.message);
			}
			throw error;
		}
	}
}

const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * Cria conexões, fila e worker. Como a da pesquisa, **não espera a conexão**.
 *
 * Concorrência 5: entregar é só HTTP, sem navegador, e um destino lento não
 * deve atrasar os outros avisos.
 */
export const createBullmqWebhookQueue = (
	url: string,
	sender: Pick<HttpWebhookSender, "send">,
): BullmqWebhookQueue => {
	let down = false;
	const connections = createBullmqConnections(url, {
		up: () => {
			if (!down) return;
			down = false;
			console.log(
				"📨 [WEBHOOK] Redis is responding again — webhook delivery back on.",
			);
		},
		down: (operation, error) => {
			if (down) return;
			down = true;
			console.warn(
				`⚠️ [WEBHOOK] Redis ${operation} failed (${errorMessage(error)}) — webhooks wait until it responds.`,
			);
		},
	});

	const queue = new Queue(WEBHOOK_QUEUE_NAME, {
		connection: connections.producer,
	});
	queue.on("error", (error) =>
		console.warn(`⚠️ [WEBHOOK] Queue error: ${errorMessage(error)}`),
	);

	return new BullmqWebhookQueue(
		{
			queue,
			isConnected: connections.isProducerReady,
			createWorker: (processor) => {
				const worker = new Worker(WEBHOOK_QUEUE_NAME, processor, {
					connection: connections.worker,
					concurrency: 5,
					autorun: false,
					settings: {
						backoffStrategy: (attemptsMade: number) =>
							webhookRetryDelayMs(attemptsMade),
					},
				});
				worker.on("error", (error) =>
					console.warn(`⚠️ [WEBHOOK] Worker error: ${errorMessage(error)}`),
				);
				worker.on("completed", (job) =>
					console.log(
						`📨 [WEBHOOK] Delivered the result of request ${job.id}.`,
					),
				);
				worker.on("failed", (job, error) => {
					const final =
						!job ||
						job.attemptsMade >= (job.opts.attempts ?? 1) ||
						error instanceof UnrecoverableError;
					console.warn(
						`⚠️ [WEBHOOK] Delivery of request ${job?.id} failed (attempt ${job?.attemptsMade}): ${error.message}${final ? " — giving up." : " — will retry."}`,
					);
				});
				return worker;
			},
			disconnect: connections.disconnect,
		},
		sender,
	);
};
