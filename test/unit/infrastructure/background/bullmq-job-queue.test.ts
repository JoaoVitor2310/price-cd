import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	BullmqJob,
	BullmqJobProcessor,
} from "@/infrastructure/background/bullmq-clients.js";
import { BullmqJobQueue } from "@/infrastructure/background/bullmq-job-queue.js";
import { LONG_JOB_OPTIONS } from "@/infrastructure/background/long-job-policy.js";

type Request = { steam_id: string };

/**
 * A fila genérica com dublês da BullMQ. O desligamento ordenado é do
 * `ResumableBullmqWorker` (testes próprios); aqui, só o que esta classe junta.
 */
function setup(deduplicationId?: string) {
	const calls: string[] = [];
	const queue = {
		add: vi.fn().mockResolvedValue({ id: "1" }),
		close: vi.fn(async () => void calls.push("queue.close")),
	};
	const worker = {
		run: vi.fn(() => new Promise<void>(() => {})),
		close: vi.fn(async () => void calls.push("worker.close")),
	};
	let processor: BullmqJobProcessor | undefined;
	const deps = {
		queue,
		isConnected: vi.fn(() => true),
		disconnect: vi.fn(async () => void calls.push("disconnect")),
		createWorker: (p: BullmqJobProcessor) => {
			processor = p;
			return worker;
		},
	};
	const run = vi.fn().mockResolvedValue(undefined);
	const parse = vi.fn((data: unknown) => {
		const { steam_id } = data as { steam_id?: unknown };
		if (typeof steam_id !== "string")
			throw new Error("Invalid lists job payload");
		return { steam_id };
	});
	const adapter = new BullmqJobQueue<Request>(deps, {
		label: "lists",
		tag: "[LISTS]",
		icon: "🗒️",
		jobName: "run-lists",
		deduplicationId,
		parse,
		run,
	});
	if (!processor) throw new Error("the adapter did not create its worker");

	const job = (data: unknown): BullmqJob => ({
		id: "7",
		data,
		moveToDelayed: vi.fn(async () => {}),
	});
	return {
		adapter,
		deps,
		queue,
		worker,
		run,
		parse,
		process: processor,
		job,
		calls,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("BullmqJobQueue", () => {
	describe("enqueue", () => {
		it("stores the request as job data, with the execution-log retention", async () => {
			const { adapter, queue } = setup();

			await adapter.enqueue({ steam_id: "76561198000000001" });

			expect(queue.add).toHaveBeenCalledWith(
				"run-lists",
				{ steam_id: "76561198000000001" },
				LONG_JOB_OPTIONS,
			);
		});

		it("does not deduplicate requests unless asked", async () => {
			const { adapter, queue } = setup();

			await adapter.enqueue({ steam_id: "1" });

			expect(queue.add.mock.calls[0][2]).not.toHaveProperty("deduplication");
		});

		it("deduplicates by the configured id while a job is alive", async () => {
			const { adapter, queue } = setup("find-new-suppliers");

			await adapter.enqueue({ steam_id: "1" });

			expect(queue.add).toHaveBeenCalledWith(
				"run-lists",
				{ steam_id: "1" },
				{
					...LONG_JOB_OPTIONS,
					deduplication: { id: "find-new-suppliers" },
				},
			);
		});

		it("never retries a long job on its own", () => {
			// Repetir depois de chamar o Estoque cria outra Trade, ou pergunta de
			// novo se comenta.
			expect(LONG_JOB_OPTIONS).not.toHaveProperty("attempts");
		});

		it("refuses at once when Redis is not connected, warning once", async () => {
			const { adapter, deps, queue } = setup();
			deps.isConnected.mockReturnValue(false);
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			adapter.reportDown("connection", new Error("ECONNREFUSED"));

			await expect(adapter.enqueue({ steam_id: "1" })).rejects.toThrow(
				"Lists queue unavailable: Redis is not connected",
			);
			expect(queue.add).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
		});

		it("propagates a failure to store, so the request is not answered with 202", async () => {
			const { adapter, queue } = setup();
			queue.add.mockRejectedValue(new Error("OOM command not allowed"));

			await expect(adapter.enqueue({ steam_id: "1" })).rejects.toThrow(
				"OOM command not allowed",
			);
		});
	});

	describe("consuming", () => {
		it("starts the worker only at application bootstrap", () => {
			const { adapter, worker } = setup();

			expect(worker.run).not.toHaveBeenCalled();
			adapter.onApplicationBootstrap();
			expect(worker.run).toHaveBeenCalledTimes(1);
		});

		it("runs the request read from the job, with the cancellation signal", async () => {
			const { process, job, run } = setup();

			await process(job({ steam_id: "76561198000000001" }), "lock-token");

			expect(run).toHaveBeenCalledWith(
				{ steam_id: "76561198000000001" },
				expect.any(AbortSignal),
			);
		});

		it("fails a job whose payload does not match, without running anything", async () => {
			const { process, job, run } = setup();

			await expect(process(job({ steam_id: 7 }))).rejects.toThrow(
				"Invalid lists job payload",
			);
			expect(run).not.toHaveBeenCalled();
		});
	});

	describe("shutdown", () => {
		it("closes the worker before the queue and its connections", async () => {
			const { adapter, calls } = setup();

			await adapter.beforeApplicationShutdown();
			await adapter.onApplicationShutdown();

			expect(calls).toEqual(["worker.close", "queue.close", "disconnect"]);
		});
	});
});
