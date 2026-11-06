import { describe, it, expect, vi } from "vitest";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import {
	EnqueueResearchGamesUseCase,
	InvalidResearchRequestError,
} from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type {
	PreviousResearchRun,
	ResearchQueue,
} from "@/application/games/ports/research-queue.port.js";
import type { ResearchResultNotifier } from "@/application/games/ports/research-result-notifier.port.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeRequest(
	overrides: Partial<ResearchGamesRequest> = {},
): ResearchGamesRequest {
	return {
		gameNames: ["Half-Life"],
		criteria: resolveSearchCriteria("default", { checkGamivoOffer: true }),
		supplierSteamId: "76561198888888888",
		listCode: "G0eXM",
		title: "Trade from supplier X",
		...overrides,
	};
}

function makeQueue(
	enqueue: ResearchQueue["enqueue"] = vi.fn().mockResolvedValue(undefined),
) {
	return {
		enqueue: vi.fn(enqueue),
		previousRun: vi
			.fn<ResearchQueue["previousRun"]>()
			.mockResolvedValue("none"),
		forget: vi.fn<ResearchQueue["forget"]>().mockResolvedValue(undefined),
		status: vi.fn().mockResolvedValue("up"),
	} satisfies ResearchQueue;
}

function makeNotifier() {
	return {
		notify: vi
			.fn<ResearchResultNotifier["notify"]>()
			.mockResolvedValue(undefined),
		redeliver: vi
			.fn<ResearchResultNotifier["redeliver"]>()
			.mockResolvedValue(true),
		forget: vi
			.fn<ResearchResultNotifier["forget"]>()
			.mockResolvedValue(undefined),
	} satisfies ResearchResultNotifier;
}

const useCase = (
	queue: ResearchQueue,
	hosts: readonly string[] = ALLOWED,
	notifier: ResearchResultNotifier = makeNotifier(),
) => new EnqueueResearchGamesUseCase(queue, notifier, hosts);

const ALLOWED = ["chatbot", "chatbot.carcadeals.com"];

// ---------------------------------------------------------------------------

describe("EnqueueResearchGamesUseCase", () => {
	it("hands the request to the queue as data", async () => {
		const queue = makeQueue();
		const request = makeRequest({ title: "Specific trade" });

		await useCase(queue).execute({ request });

		expect(queue.enqueue).toHaveBeenCalledTimes(1);
		expect(queue.enqueue).toHaveBeenCalledWith(request);
	});

	it("resolves only after the queue has stored the request", async () => {
		let store: (() => void) | undefined;
		const queue = makeQueue(
			() =>
				new Promise<void>((resolve) => {
					store = resolve;
				}),
		);

		let resolved = false;
		const pending = useCase(queue)
			.execute({ request: makeRequest() })
			.then(() => {
				resolved = true;
			});

		// O 202 só pode sair depois de o pedido estar guardado.
		await Promise.resolve();
		expect(resolved).toBe(false);

		store?.();
		await pending;
		expect(resolved).toBe(true);
	});

	it("propagates a failure to store the request, so the caller does not get a 202", async () => {
		const queue = makeQueue(() =>
			Promise.reject(new Error("Stream isn't writeable")),
		);

		await expect(
			useCase(queue).execute({
				request: makeRequest(),
			}),
		).rejects.toThrow("Stream isn't writeable");
	});

	describe("webhook target", () => {
		it("accepts a webhook to an allowed host", async () => {
			const queue = makeQueue();
			const request = makeRequest({
				currency: "eur",
				requestUuid: "8c1f0000-0000-4000-8000-000000000000",
				webhookUrl: "http://chatbot:3000/webhooks/price-cd",
			});

			await useCase(queue).execute({
				request,
			});

			expect(queue.enqueue).toHaveBeenCalledWith(request);
		});

		it("refuses a webhook to a host outside the list, before storing anything", async () => {
			const queue = makeQueue();
			const request = makeRequest({
				currency: "eur",
				requestUuid: "8c1f0000-0000-4000-8000-000000000000",
				webhookUrl: "http://redis:6379/",
			});

			await expect(useCase(queue).execute({ request })).rejects.toBeInstanceOf(
				InvalidResearchRequestError,
			);
			expect(queue.enqueue).not.toHaveBeenCalled();
		});

		it("refuses every webhook when no host is allowed", async () => {
			const request = makeRequest({
				webhookUrl: "https://chatbot.carcadeals.com/hook",
			});

			await expect(
				useCase(makeQueue(), []).execute({ request }),
			).rejects.toThrow("webhook_url host is not allowed");
		});
	});
	describe("the same request_uuid again", () => {
		const REQUEST_UUID = "8c1f0000-0000-4000-8000-000000000000";
		const resent = () =>
			makeRequest({
				currency: "eur",
				requestUuid: REQUEST_UUID,
				webhookUrl: "http://chatbot:3000/webhooks/price-cd",
			});

		const run = async (previous: PreviousResearchRun) => {
			const queue = makeQueue();
			queue.previousRun.mockResolvedValue(previous);
			const notifier = makeNotifier();
			await useCase(queue, ALLOWED, notifier).execute({ request: resent() });
			return { queue, notifier };
		};

		it("does nothing while the first one is still queued or running: it will report", async () => {
			const { queue, notifier } = await run("pending");

			expect(queue.previousRun).toHaveBeenCalledWith(REQUEST_UUID);
			expect(queue.enqueue).not.toHaveBeenCalled();
			expect(notifier.redeliver).not.toHaveBeenCalled();
		});

		it("delivers the stored result again once the first one completed, without researching again", async () => {
			const { queue, notifier } = await run("completed");

			expect(notifier.redeliver).toHaveBeenCalledWith(REQUEST_UUID);
			expect(queue.enqueue).not.toHaveBeenCalled();
		});

		it("refuses when a webhook is expected and there is no stored result to deliver", async () => {
			const queue = makeQueue();
			queue.previousRun.mockResolvedValue("completed");
			const notifier = makeNotifier();
			notifier.redeliver.mockResolvedValue(false);

			await expect(
				useCase(queue, ALLOWED, notifier).execute({ request: resent() }),
			).rejects.toBeInstanceOf(InvalidResearchRequestError);
			expect(queue.enqueue).not.toHaveBeenCalled();
		});

		it("stays quiet when nobody expects a webhook and there is nothing stored", async () => {
			const queue = makeQueue();
			queue.previousRun.mockResolvedValue("completed");
			const notifier = makeNotifier();
			notifier.redeliver.mockResolvedValue(false);

			await expect(
				useCase(queue, ALLOWED, notifier).execute({
					request: makeRequest({ requestUuid: REQUEST_UUID }),
				}),
			).resolves.toBeUndefined();
			expect(queue.enqueue).not.toHaveBeenCalled();
		});

		it("does not run again when the old result cannot be cleared", async () => {
			const queue = makeQueue();
			queue.previousRun.mockResolvedValue("failed");
			const notifier = makeNotifier();
			notifier.forget.mockRejectedValue(new Error("Job is locked"));

			await expect(
				useCase(queue, ALLOWED, notifier).execute({ request: resent() }),
			).rejects.toThrow("Job is locked");
			expect(queue.forget).not.toHaveBeenCalled();
			expect(queue.enqueue).not.toHaveBeenCalled();
		});

		it("runs again after a failure, forgetting the old result first so the new one is not ignored", async () => {
			const { queue, notifier } = await run("failed");

			expect(notifier.forget).toHaveBeenCalledWith(REQUEST_UUID);
			expect(queue.forget).toHaveBeenCalledWith(REQUEST_UUID);
			expect(queue.enqueue).toHaveBeenCalledWith(resent());
			expect(queue.forget.mock.invocationCallOrder[0]).toBeLessThan(
				queue.enqueue.mock.invocationCallOrder[0],
			);
		});

		it("runs a request it has no record of", async () => {
			const { queue, notifier } = await run("none");

			expect(queue.enqueue).toHaveBeenCalledTimes(1);
			expect(notifier.forget).not.toHaveBeenCalled();
		});

		it("does not look anything up for a request without request_uuid", async () => {
			const queue = makeQueue();

			await useCase(queue).execute({ request: makeRequest() });

			expect(queue.previousRun).not.toHaveBeenCalled();
			expect(queue.enqueue).toHaveBeenCalledTimes(1);
		});
	});
});
