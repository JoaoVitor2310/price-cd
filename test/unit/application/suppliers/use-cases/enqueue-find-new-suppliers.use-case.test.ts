import { describe, expect, it, vi } from "vitest";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/use-cases/enqueue-find-new-suppliers.use-case.js";

describe("EnqueueFindNewSuppliersUseCase", () => {
	it("stores a request saying when it was made, and nothing else", async () => {
		const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
		const now = () => new Date("2026-11-07T10:03:00.000Z");

		await new EnqueueFindNewSuppliersUseCase(queue, now).execute();

		expect(queue.enqueue).toHaveBeenCalledWith({
			requestedAt: "2026-11-07T10:03:00.000Z",
		});
	});

	it("lets a failure to store reach the request, instead of a 202 that loses it", async () => {
		const queue = {
			enqueue: vi.fn().mockRejectedValue(new Error("Redis is not connected")),
		};

		await expect(
			new EnqueueFindNewSuppliersUseCase(queue).execute(),
		).rejects.toThrow("Redis is not connected");
	});
});
