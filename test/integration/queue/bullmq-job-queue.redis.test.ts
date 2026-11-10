import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BullmqJobQueue,
	createBullmqJobQueue,
} from "@/infrastructure/background/bullmq-job-queue.js";
import { parseListsRunJobPayload } from "@/infrastructure/background/lists-run-job-payload.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";
import { queueTestUrl } from "./queue-test-db.js";

/**
 * A fila genérica dos jobs longos (Reabastecimento, Descoberta) contra um Redis
 * de verdade. **Opcional**, como o da pesquisa: só roda com `QUEUE_REDIS_TEST_URL`
 * e faz `FLUSHDB` no banco dela. Ver `bullmq-research-queue.redis.test.ts`.
 *
 * Prova o que só esta fila tem: concorrência acima de 1, com todos os jobs em
 * andamento devolvidos no desligamento.
 */
/** Dois bancos longe do da pesquisa (`queue-test-db.ts`). */
const url = queueTestUrl(2);
const QUEUE_NAME = "lists";

const request = (steam_id: string): SupplierListRequest => ({
	steam_id,
	checkGamivoOffer: true,
});

const waitFor = async (
	condition: () => Promise<boolean>,
	timeoutMs = 10_000,
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("condition not met in time");
};

describe.skipIf(!url)("BullmqJobQueue against a real Redis", () => {
	let admin: Redis;
	let inspector: Queue;
	const started: BullmqJobQueue<SupplierListRequest>[] = [];

	const start = (
		run: (request: SupplierListRequest, signal: AbortSignal) => Promise<void>,
		concurrency = 1,
		deduplicationId?: string,
	) => {
		const queue = createBullmqJobQueue<SupplierListRequest>(url as string, {
			queueName: QUEUE_NAME,
			jobName: "run-lists",
			concurrency,
			deduplicationId,
			label: "lists",
			tag: "[LISTS]",
			icon: "🗒️",
			parse: parseListsRunJobPayload,
			run,
		});
		started.push(queue);
		return queue;
	};

	const stop = async (queue: BullmqJobQueue<SupplierListRequest>) => {
		await queue.beforeApplicationShutdown();
		await queue.onApplicationShutdown();
		started.splice(started.indexOf(queue), 1);
	};

	/** O primeiro `enqueue` só passa com a conexão do produtor pronta. */
	const enqueueWhenConnected = (
		queue: BullmqJobQueue<SupplierListRequest>,
		data: SupplierListRequest,
	) =>
		waitFor(async () => {
			try {
				await queue.enqueue(data);
				return true;
			} catch {
				return false;
			}
		});

	beforeEach(async () => {
		admin = new Redis(url as string);
		await admin.flushdb();
		inspector = new Queue(QUEUE_NAME, {
			connection: new Redis(url as string, { maxRetriesPerRequest: null }),
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		for (const queue of [...started]) await stop(queue).catch(() => undefined);
		await inspector.close();
		await (await inspector.client).quit().catch(() => undefined);
		await admin.quit();
		vi.restoreAllMocks();
	});

	it("runs an enqueued request, read back from Redis, and keeps it in the execution log", async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const queue = start(run);
		queue.onApplicationBootstrap();

		await enqueueWhenConnected(queue, request("76561198000000001"));

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		expect(run).toHaveBeenCalledWith(
			request("76561198000000001"),
			expect.any(AbortSignal),
		);
	});

	it("fails a job whose payload does not match, without running anything", async () => {
		const run = vi.fn();
		vi.spyOn(console, "error").mockImplementation(() => {});
		const queue = start(run);
		queue.onApplicationBootstrap();
		await inspector.add("run-lists", { steam_id: 7 });

		await waitFor(
			async () => (await inspector.getJobCounts("failed")).failed === 1,
		);
		const [failed] = await inspector.getFailed();
		expect(failed.failedReason).toContain("Invalid lists job payload");
		expect(run).not.toHaveBeenCalled();
	});

	it("returns every job in progress at shutdown, and the next instance runs them all again", async () => {
		// Concorrência 2: dois Reabastecimentos rodando quando o deploy chega.
		const signals: AbortSignal[] = [];
		const first = start(async (_request, signal) => {
			signals.push(signal);
			await new Promise(() => {});
		}, 2);
		first.onApplicationBootstrap();
		await enqueueWhenConnected(first, request("76561198000000001"));
		await first.enqueue(request("76561198000000002"));
		await waitFor(async () => signals.length === 2);

		await stop(first);

		expect(signals.every((signal) => signal.aborted)).toBe(true);
		const counts = await inspector.getJobCounts(
			"active",
			"delayed",
			"wait",
			"failed",
		);
		expect(counts.active + counts.failed).toBe(0);
		expect(counts.delayed + counts.wait).toBe(2);

		const run = vi.fn().mockResolvedValue(undefined);
		const second = start(run, 2);
		second.onApplicationBootstrap();

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 2,
		);
		expect(run.mock.calls.map(([data]) => data.steam_id).sort()).toEqual([
			"76561198000000001",
			"76561198000000002",
		]);
		// Interrupção não é tentativa.
		for (const job of await inspector.getCompleted()) {
			expect(job.attemptsMade).toBe(1);
		}
	});

	it("absorbs a repeated request while one is alive, and accepts a new one after it finishes", async () => {
		// O caso da Descoberta: a varredura não tem parâmetro, então um pedido com
		// outra esperando ou rodando é o mesmo pedido.
		let finishRun: (() => void) | undefined;
		const run = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishRun = resolve;
				}),
		);
		const queue = start(run, 1, "find-new-suppliers");
		await enqueueWhenConnected(queue, request("76561198000000001"));
		await queue.enqueue(request("76561198000000001"));
		expect((await inspector.getJobCounts("wait")).wait).toBe(1);

		queue.onApplicationBootstrap();
		await waitFor(async () => run.mock.calls.length === 1);
		// Rodando: ainda absorvido.
		await queue.enqueue(request("76561198000000001"));
		expect((await inspector.getJobCounts("wait")).wait).toBe(0);

		finishRun?.();
		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		// Terminado: o próximo pedido é uma execução nova, e o registro fica.
		await queue.enqueue(request("76561198000000001"));
		await waitFor(async () => run.mock.calls.length === 2);
		finishRun?.();
		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 2,
		);
	});
});
