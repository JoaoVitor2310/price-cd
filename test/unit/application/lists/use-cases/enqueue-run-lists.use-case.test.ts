import { describe, expect, it, vi } from "vitest";
import { EnqueueRunListsUseCase } from "@/application/lists/use-cases/enqueue-run-lists.use-case.js";

const request = { steam_id: "76561198000000000", checkGamivoOffer: true };

describe("EnqueueRunListsUseCase", () => {
	it("stores the request as data, without running it", async () => {
		const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };

		await new EnqueueRunListsUseCase(queue).execute({ request });

		expect(queue.enqueue).toHaveBeenCalledWith(request);
	});

	it("lets a failure to store reach the request, instead of a 202 that loses it", async () => {
		const queue = {
			enqueue: vi.fn().mockRejectedValue(new Error("Redis is not connected")),
		};

		await expect(
			new EnqueueRunListsUseCase(queue).execute({ request }),
		).rejects.toThrow("Redis is not connected");
	});
});
