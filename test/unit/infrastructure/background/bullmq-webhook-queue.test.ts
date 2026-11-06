import { UnrecoverableError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BullmqJob,
	type BullmqJobProcessor,
	type BullmqQueueClient,
	type BullmqStoredJob,
	toRunState,
} from "@/infrastructure/background/bullmq-clients.js";
import {
	BullmqWebhookQueue,
	WEBHOOK_JOB_OPTIONS,
	WEBHOOK_MAX_ATTEMPTS,
	webhookRetryDelayMs,
} from "@/infrastructure/background/bullmq-webhook-queue.js";
import { InMemoryWebhookNotifier } from "@/infrastructure/background/in-memory-webhook-notifier.js";
import { WebhookTargetNotAllowedError } from "@/infrastructure/webhooks/http-webhook-sender.js";

const REQUEST_UUID = "8c1f0000-0000-4000-8000-000000000000";
const target = {
	webhookUrl: "http://chatbot:3000/webhooks/price-cd",
	requestUuid: REQUEST_UUID,
};

function setup() {
	const queue = {
		add: vi.fn().mockResolvedValue({ id: REQUEST_UUID }),
		getJob: vi.fn<BullmqQueueClient["getJob"]>().mockResolvedValue(undefined),
		close: vi.fn(async () => {}),
	};
	const worker = {
		run: vi.fn(() => new Promise<void>(() => {})),
		close: vi.fn(async () => {}),
	};
	const sender = { send: vi.fn().mockResolvedValue(undefined) };
	let processor: BullmqJobProcessor | undefined;
	const deps = {
		queue,
		isConnected: vi.fn(() => true),
		disconnect: vi.fn(async () => {}),
		createWorker: vi.fn((p: BullmqJobProcessor) => {
			processor = p;
			return worker;
		}),
	};
	const adapter = new BullmqWebhookQueue(deps, sender);
	if (!processor) throw new Error("the adapter did not create its worker");

	const job = (data: unknown): BullmqJob => ({
		id: REQUEST_UUID,
		data,
		moveToDelayed: vi.fn(),
	});
	return { adapter, deps, queue, worker, sender, process: processor, job };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("webhook retry schedule", () => {
	it("doubles from 30s up to 1h", () => {
		expect([1, 2, 3, 4, 7, 8, 30].map(webhookRetryDelayMs)).toEqual([
			30_000, 60_000, 120_000, 240_000, 1_920_000, 3_600_000, 3_600_000,
		]);
	});

	it("keeps trying for about 24 hours, then gives up", () => {
		// Esperas entre as tentativas: a 1ª sai na hora, cada uma das outras
		// depois de `webhookRetryDelayMs(tentativas já feitas)`.
		let total = 0;
		for (
			let attemptsMade = 1;
			attemptsMade < WEBHOOK_MAX_ATTEMPTS;
			attemptsMade++
		) {
			total += webhookRetryDelayMs(attemptsMade);
		}
		const hours = total / 3_600_000;

		expect(hours).toBeGreaterThanOrEqual(24);
		expect(hours).toBeLessThan(25);
		expect(WEBHOOK_JOB_OPTIONS).toMatchObject({
			attempts: WEBHOOK_MAX_ATTEMPTS,
			backoff: { type: "custom" },
		});
	});
});

describe("BullmqWebhookQueue", () => {
	describe("notify", () => {
		it("stores one delivery per request, keyed by the request uuid, already in the wire format", async () => {
			const { adapter, queue } = setup();

			await adapter.notify(target, {
				result: "trade_created",
				tradeUuid: "3a9e",
			});

			expect(queue.add).toHaveBeenCalledWith(
				"research-result",
				{
					url: target.webhookUrl,
					body: {
						request_uuid: REQUEST_UUID,
						result: "trade_created",
						trade_uuid: "3a9e",
					},
				},
				{ ...WEBHOOK_JOB_OPTIONS, jobId: REQUEST_UUID },
			);
		});

		it("refuses at once when Redis is not connected", async () => {
			const { adapter, deps, queue } = setup();
			deps.isConnected.mockReturnValue(false);

			await expect(
				adapter.notify(target, { result: "no_trade" }),
			).rejects.toThrow("Webhook queue unavailable");
			expect(queue.add).not.toHaveBeenCalled();
		});
	});

	describe("delivery", () => {
		const payload = {
			url: target.webhookUrl,
			body: { request_uuid: REQUEST_UUID, result: "no_trade" },
		};

		it("sends the stored body to the stored URL", async () => {
			const { process, job, sender } = setup();

			await process(job(payload));

			expect(sender.send).toHaveBeenCalledWith(payload.url, payload.body);
		});

		it("lets a failed attempt fail, so BullMQ tries again", async () => {
			const { process, job, sender } = setup();
			sender.send.mockRejectedValue(new Error("Webhook answered HTTP 503"));

			const error = await process(job(payload)).catch((e) => e);
			expect(error.message).toBe("Webhook answered HTTP 503");
			expect(error).not.toBeInstanceOf(UnrecoverableError);
		});

		it("gives up at once on a host that is no longer allowed", async () => {
			const { process, job, sender } = setup();
			sender.send.mockRejectedValue(
				new WebhookTargetNotAllowedError(payload.url),
			);

			await expect(process(job(payload))).rejects.toBeInstanceOf(
				UnrecoverableError,
			);
		});

		it("gives up at once on a payload it cannot read", async () => {
			const { process, job, sender } = setup();

			await expect(process(job({ url: payload.url }))).rejects.toBeInstanceOf(
				UnrecoverableError,
			);
			expect(sender.send).not.toHaveBeenCalled();
		});
	});

	describe("the same request again", () => {
		const stored = (state: string) =>
			({
				getState: vi.fn().mockResolvedValue(state),
				remove: vi.fn().mockResolvedValue(undefined),
				retry: vi.fn().mockResolvedValue(undefined),
			}) satisfies BullmqStoredJob;

		it.each(["completed", "failed"] as const)(
			"redelivers a %s result with the attempts reset",
			async (state) => {
				const { adapter, queue } = setup();
				const job = stored(state);
				queue.getJob.mockResolvedValue(job);

				await expect(adapter.redeliver(REQUEST_UUID)).resolves.toBe(true);

				expect(queue.getJob).toHaveBeenCalledWith(REQUEST_UUID);
				expect(job.retry).toHaveBeenCalledWith(state, {
					resetAttemptsMade: true,
					resetAttemptsStarted: true,
				});
			},
		);

		it("leaves a delivery still in progress alone: it will arrive", async () => {
			const { adapter, queue } = setup();
			const job = stored("delayed");
			queue.getJob.mockResolvedValue(job);

			await expect(adapter.redeliver(REQUEST_UUID)).resolves.toBe(true);
			expect(job.retry).not.toHaveBeenCalled();
		});

		it("says when there is nothing stored to redeliver", async () => {
			const { adapter } = setup();

			await expect(adapter.redeliver(REQUEST_UUID)).resolves.toBe(false);
		});

		it("forgets the stored result, even one still waiting for its next attempt", async () => {
			const { adapter, queue } = setup();
			const job = stored("delayed");
			queue.getJob.mockResolvedValue(job);

			await adapter.forget(REQUEST_UUID);

			expect(job.remove).toHaveBeenCalled();
		});

		it("fails when the result is being sent right now, so nothing runs behind it", async () => {
			const { adapter, queue } = setup();
			const job = stored("active");
			job.remove.mockRejectedValue(new Error("Job is locked"));
			queue.getJob.mockResolvedValue(job);

			await expect(adapter.forget(REQUEST_UUID)).rejects.toThrow(
				"Job is locked",
			);
		});

		it("gives up on a stuck Redis instead of hanging the request", async () => {
			vi.useFakeTimers();
			const { adapter, queue } = setup();
			const job = stored("completed");
			job.getState.mockReturnValue(new Promise(() => {}));
			queue.getJob.mockResolvedValue(job);

			const redelivery = adapter.redeliver(REQUEST_UUID);
			const outcome = expect(redelivery).rejects.toThrow("timed out");
			await vi.advanceTimersByTimeAsync(5000);
			await outcome;
			vi.useRealTimers();
		});

		it("refuses at once when Redis is not connected", async () => {
			const { adapter, deps } = setup();
			deps.isConnected.mockReturnValue(false);

			await expect(adapter.redeliver(REQUEST_UUID)).rejects.toThrow(
				"Webhook queue unavailable",
			);
			await expect(adapter.forget(REQUEST_UUID)).rejects.toThrow(
				"Webhook queue unavailable",
			);
		});
	});

	describe("lifecycle", () => {
		it("starts consuming on bootstrap", () => {
			const { adapter, worker } = setup();

			adapter.onApplicationBootstrap();

			expect(worker.run).toHaveBeenCalledTimes(1);
		});

		it("stops waiting for the delivery when closing hangs, so the shutdown goes on", async () => {
			vi.useFakeTimers();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const { adapter, worker } = setup();
			worker.close.mockReturnValueOnce(new Promise<void>(() => {}));

			const shutdown = adapter.beforeApplicationShutdown();
			await vi.advanceTimersByTimeAsync(15_000);
			await shutdown;

			expect(worker.close).toHaveBeenLastCalledWith(true);
			warn.mockRestore();
			vi.useRealTimers();
		});

		it("waits for the delivery in progress on shutdown, then releases the connections", async () => {
			const { adapter, worker, queue, deps } = setup();

			await adapter.beforeApplicationShutdown();
			await adapter.onApplicationShutdown();

			// Sem `force`: uma entrega dura no máximo o timeout do envio.
			expect(worker.close).toHaveBeenCalledWith();
			expect(queue.close).toHaveBeenCalled();
			expect(deps.disconnect).toHaveBeenCalled();
		});
	});
});

describe("InMemoryWebhookNotifier", () => {
	it("sends once in the background and logs a failure instead of throwing", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const sender = {
			send: vi.fn().mockRejectedValue(new Error("Webhook answered HTTP 500")),
		};

		await expect(
			new InMemoryWebhookNotifier(sender).notify(target, {
				result: "no_trade",
			}),
		).resolves.toBeUndefined();

		await vi.waitFor(() => expect(warn).toHaveBeenCalled());
		expect(sender.send).toHaveBeenCalledWith(target.webhookUrl, {
			request_uuid: REQUEST_UUID,
			result: "no_trade",
		});
	});
});

describe("toRunState", () => {
	const job = { getState: vi.fn(), remove: vi.fn(), retry: vi.fn() };

	it.each([
		["completed", "completed"],
		["failed", "failed"],
		["waiting", "pending"],
		["active", "pending"],
		["delayed", "pending"],
		["prioritized", "pending"],
		["waiting-children", "pending"],
		["unknown", "none"],
	])("%s → %s", (state, expected) => {
		expect(toRunState(job, state)).toBe(expected);
	});

	it("a missing job is none", () => {
		expect(toRunState(undefined, undefined)).toBe("none");
	});
});
