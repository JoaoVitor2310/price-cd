import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryJobQueue } from "@/infrastructure/background/in-memory-job-queue.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("InMemoryJobQueue", () => {
	it("runs the request in the background, after enqueue resolves", async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const queue = new InMemoryJobQueue(
			new LimitedConcurrencyScheduler(1),
			run,
			"lists",
		);

		await queue.enqueue({ steam_id: "1" });

		await vi.waitFor(() => expect(run).toHaveBeenCalledWith({ steam_id: "1" }));
	});

	it("logs a failed run instead of breaking the queue", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("SteamTrades is down"))
			.mockResolvedValue(undefined);
		const queue = new InMemoryJobQueue(
			new LimitedConcurrencyScheduler(1),
			run,
			"lists",
		);

		await queue.enqueue({ steam_id: "1" });
		await queue.enqueue({ steam_id: "2" });

		await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
		expect(logged).toHaveBeenCalledWith(
			"❌ [ERROR] lists run failed:",
			expect.any(Error),
		);
	});
});
