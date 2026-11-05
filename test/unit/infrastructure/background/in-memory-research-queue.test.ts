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
		const runner = { run: vi.fn().mockResolvedValue(undefined) };

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
		};
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => {});

		await new InMemoryResearchQueue(scheduler, runner).enqueue(request);

		await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalled();
		consoleError.mockRestore();
	});

	it("reports itself as in-memory, never as up", async () => {
		const queue = new InMemoryResearchQueue(makeScheduler(), { run: vi.fn() });

		expect(await queue.status()).toBe("in-memory");
	});
});
