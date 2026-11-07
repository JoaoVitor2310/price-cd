import { describe, expect, it, vi } from "vitest";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { InMemoryResearchQueue } from "@/infrastructure/background/in-memory-research-queue.js";

const request: ResearchGamesRequest = {
	gameNames: ["Half-Life"],
	criteria: resolveSearchCriteria("default", {}),
};

/** Scheduler fake que captura a task em vez de executá-la. */
function makeScheduler() {
	let captured: (() => Promise<void>) | undefined;
	return {
		schedule: vi.fn((task: () => Promise<void>) => {
			captured = task;
		}),
		runScheduledTask: () => {
			if (!captured) throw new Error("No task was scheduled");
			return captured();
		},
	};
}

describe("InMemoryResearchQueue", () => {
	it("schedules the run instead of running it inline", async () => {
		const scheduler = makeScheduler();
		const runner = {
			run: vi.fn().mockResolvedValue(undefined),
			reportFailure: vi.fn(),
		};

		await new InMemoryResearchQueue(scheduler, runner).enqueue(request);

		expect(scheduler.schedule).toHaveBeenCalledTimes(1);
		expect(runner.run).not.toHaveBeenCalled();

		await scheduler.runScheduledTask();
		expect(runner.run).toHaveBeenCalledWith(request);
	});

	it("swallows runner errors so the scheduler loop is not broken", async () => {
		const scheduler = makeScheduler();
		const runner = {
			run: vi.fn().mockRejectedValue(new Error("scraping failed")),
			reportFailure: vi.fn().mockResolvedValue(undefined),
		};
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await new InMemoryResearchQueue(scheduler, runner).enqueue(request);

		await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("reports a failed run to whoever asked", async () => {
		const scheduler = makeScheduler();
		const error = new Error("scraping failed");
		const runner = {
			run: vi.fn().mockRejectedValue(error),
			reportFailure: vi.fn().mockResolvedValue(undefined),
		};
		vi.spyOn(console, "error").mockImplementation(() => {});

		await new InMemoryResearchQueue(scheduler, runner).enqueue(request);
		await scheduler.runScheduledTask();

		expect(runner.reportFailure).toHaveBeenCalledWith(request, error);
		vi.restoreAllMocks();
	});

	it("does not break the scheduler loop when the failure cannot be reported", async () => {
		const scheduler = makeScheduler();
		const runner = {
			run: vi.fn().mockRejectedValue(new Error("scraping failed")),
			reportFailure: vi.fn().mockRejectedValue(new Error("no webhook queue")),
		};
		vi.spyOn(console, "error").mockImplementation(() => {});

		await new InMemoryResearchQueue(scheduler, runner).enqueue(request);

		await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
		vi.restoreAllMocks();
	});

	it("reports itself as in-memory, never as up", async () => {
		const queue = new InMemoryResearchQueue(makeScheduler(), {
			run: vi.fn(),
			reportFailure: vi.fn(),
		});

		expect(await queue.status()).toBe("in-memory");
	});
});
