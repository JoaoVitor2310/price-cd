import { DelayedError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	BullmqJob,
	BullmqJobProcessor,
} from "@/infrastructure/background/bullmq-clients.js";
import {
	ResumableBullmqWorker,
	type ResumableJobHandler,
	TRACKED_WORK_DRAIN_TIMEOUT_MS,
} from "@/infrastructure/background/resumable-bullmq-worker.js";

/**
 * O consumidor genérico, exercitado com um job que não é pesquisa: o que a fila
 * da pesquisa faz em cima dele está em `bullmq-research-queue.test.ts`.
 */
function setup(
	handle: ResumableJobHandler = vi.fn().mockResolvedValue(undefined),
) {
	const calls: string[] = [];
	const worker = {
		run: vi.fn(() => new Promise<void>(() => {})),
		close: vi.fn(async (_force?: boolean) => {
			calls.push("worker.close");
		}),
	};
	let processor: BullmqJobProcessor | undefined;
	const consumer = new ResumableBullmqWorker({
		label: "lists",
		tag: "[LISTS]",
		icon: "🔁",
		createWorker: (p) => {
			processor = p;
			return worker;
		},
		handle,
	});
	if (!processor) throw new Error("the consumer did not create its worker");

	const job = (
		data: unknown = { steamId: "76561198012345678" },
	): BullmqJob => ({
		id: "7",
		data,
		moveToDelayed: vi.fn(async () => {
			calls.push("job.moveToDelayed");
		}),
	});

	return { consumer, worker, process: processor, job, calls, handle };
}

/** Um handler que só termina quando o teste manda. */
function pendingHandler() {
	let finish: ((error?: Error) => void) | undefined;
	const handle = vi.fn<ResumableJobHandler>(
		() =>
			new Promise<void>((resolve, reject) => {
				finish = (error) => (error ? reject(error) : resolve());
			}),
	);
	return { handle, finish: (error?: Error) => finish?.(error) };
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("ResumableBullmqWorker", () => {
	it("starts consuming only when asked", () => {
		const { consumer, worker } = setup();

		expect(worker.run).not.toHaveBeenCalled();
		consumer.start();
		expect(worker.run).toHaveBeenCalledTimes(1);
	});

	it("logs, with its own label, a worker that stops", async () => {
		const { consumer, worker } = setup();
		worker.run.mockRejectedValue(new Error("boom"));
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		consumer.start();
		await new Promise((resolve) => setImmediate(resolve));

		expect(logged).toHaveBeenCalledWith(
			"❌ [LISTS] Lists worker stopped:",
			expect.any(Error),
		);
	});

	it("hands the job and a live signal to the handler", async () => {
		const { process, job, handle } = setup();
		const stored = job();

		await process(stored, "lock-token");

		expect(handle).toHaveBeenCalledWith(stored, expect.any(AbortSignal));
		expect(vi.mocked(handle).mock.calls[0][1].aborted).toBe(false);
	});

	it("lets a handler failure fail the job, so it is recorded", async () => {
		const failure = new Error("SteamTrades is down");
		const { process, job } = setup(vi.fn().mockRejectedValue(failure));

		await expect(process(job())).rejects.toBe(failure);
	});

	describe("stop", () => {
		it("aborts the signal before returning the job, then closes without waiting", async () => {
			const { handle, finish } = pendingHandler();
			const { consumer, process, job, worker, calls } = setup(handle);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			const active = job();

			const processing = process(active, "lock-token");
			await consumer.stop();

			expect(handle.mock.calls[0][1].aborted).toBe(true);
			expect(active.moveToDelayed).toHaveBeenCalledWith(
				expect.any(Number),
				"lock-token",
			);
			expect(calls).toEqual(["job.moveToDelayed", "worker.close"]);
			expect(worker.close).toHaveBeenCalledWith(true);
			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("🔁 [LISTS] Lists job 7 returned to the queue"),
			);

			// A falha que o desligamento causa não é do job.
			finish(new Error("Target closed"));
			await expect(processing).rejects.toBeInstanceOf(DelayedError);
		});

		it("warns when a returned job still finishes, because it will run again", async () => {
			const { handle, finish } = pendingHandler();
			const { consumer, process, job } = setup(handle);
			vi.spyOn(console, "log").mockImplementation(() => {});
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			const processing = process(job(), "lock-token");
			await consumer.stop();
			finish();

			// Já foi movido: `DelayedError` diz à BullMQ para não tocá-lo.
			await expect(processing).rejects.toBeInstanceOf(DelayedError);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("Lists job 7 finished during shutdown"),
			);
		});

		it("lets a job that could not be returned complete normally if it finishes", async () => {
			// O efeito já aconteceu. `DelayedError` deixaria o job ativo, ele
			// voltaria como travado e repetiria o efeito.
			const { handle, finish } = pendingHandler();
			const { consumer, process, job } = setup(handle);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const active = job();
			vi.mocked(active.moveToDelayed).mockRejectedValue(
				new Error("Connection is closed."),
			);

			const processing = process(active, "lock-token");
			await consumer.stop();
			finish();

			await expect(processing).resolves.toBeUndefined();
		});

		it("returns a job picked after it began, without running it", async () => {
			const { consumer, process, job, handle } = setup();
			await consumer.stop();
			const late = job();

			await expect(process(late, "lock-token")).rejects.toBeInstanceOf(
				DelayedError,
			);
			expect(late.moveToDelayed).toHaveBeenCalled();
			expect(handle).not.toHaveBeenCalled();
		});

		it("still closes the worker when the job cannot be returned", async () => {
			const { handle } = pendingHandler();
			const { consumer, process, job, worker } = setup(handle);
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const active = job();
			vi.mocked(active.moveToDelayed).mockRejectedValue(
				new Error("Connection is closed."),
			);

			void process(active, "lock-token");
			await consumer.stop();

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					"Could not return lists job 7 to the queue (Connection is closed.)",
				),
			);
			expect(worker.close).toHaveBeenCalledWith(true);
		});

		it("never throws when closing the worker fails", async () => {
			const { consumer, worker } = setup();
			worker.close.mockRejectedValue(new Error("already closed"));
			vi.spyOn(console, "warn").mockImplementation(() => {});

			await expect(consumer.stop()).resolves.toBeUndefined();
		});
	});

	describe("work tracked until shutdown", () => {
		it("is awaited by stop, after the worker is closed", async () => {
			const { consumer, calls } = setup();
			let finishWork: (() => void) | undefined;
			const work = new Promise<void>((resolve) => {
				finishWork = () => {
					calls.push("work.done");
					resolve();
				};
			});

			const tracked = consumer.trackUntilShutdown(work);
			const stopping = consumer.stop();
			await new Promise((resolve) => setImmediate(resolve));
			expect(calls).toEqual(["worker.close"]);

			finishWork?.();
			await stopping;
			expect(calls).toEqual(["worker.close", "work.done"]);
			await expect(tracked).resolves.toBeUndefined();
		});

		it("is forgotten once done, so stop has nothing to wait for", async () => {
			vi.useFakeTimers();
			const { consumer } = setup();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			await consumer.trackUntilShutdown(Promise.resolve());
			await consumer.stop();

			expect(warn).not.toHaveBeenCalled();
		});

		it("never rejects, even when the work does, so nothing goes unhandled", async () => {
			const { consumer } = setup();
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});

			await expect(
				consumer.trackUntilShutdown(Promise.reject(new Error("Redis down"))),
			).resolves.toBeUndefined();
			expect(logged).toHaveBeenCalledWith(
				"❌ [LISTS] Work tracked by the lists worker failed:",
				expect.any(Error),
			);
		});

		it("keeps waiting for the rest when one piece of work fails", async () => {
			const { consumer, calls } = setup();
			vi.spyOn(console, "error").mockImplementation(() => {});
			let finishSlow: (() => void) | undefined;
			const slow = new Promise<void>((resolve) => {
				finishSlow = () => {
					calls.push("slow.done");
					resolve();
				};
			});

			void consumer.trackUntilShutdown(Promise.reject(new Error("boom")));
			void consumer.trackUntilShutdown(slow);
			const stopping = consumer.stop();
			await new Promise((resolve) => setImmediate(resolve));
			finishSlow?.();
			await stopping;

			expect(calls).toEqual(["worker.close", "slow.done"]);
		});

		it("is given up on after the drain timeout", async () => {
			vi.useFakeTimers();
			const { consumer } = setup();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			void consumer.trackUntilShutdown(new Promise<void>(() => {}));
			const stopping = consumer.stop();
			await vi.advanceTimersByTimeAsync(TRACKED_WORK_DRAIN_TIMEOUT_MS);

			await expect(stopping).resolves.toBeUndefined();
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					"[LISTS] 1 task(s) tracked by the lists worker still pending at shutdown",
				),
			);
		});
	});
});
