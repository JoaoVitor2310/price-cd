import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockEnqueueRunListsService } = vi.hoisted(() => ({
	mockEnqueueRunListsService: vi.fn<() => Promise<void>>(),
}));

vi.mock("@/services/lists/enqueue-run-lists.service.js", () => ({
	enqueueRunListsService: mockEnqueueRunListsService,
}));

import app from "@/app.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/lists/run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnqueueRunListsService.mockResolvedValue(undefined);
	});

	it("returns 202 queued on valid request", async () => {
		const res = await request(app).post("/api/lists/run").send({
			steam_id: "76561198000000000",
			checkGamivoOffer: true,
		});

		expect(res.status).toBe(202);
		expect(res.body).toEqual({ success: true, status: "queued" });
	});

	it("calls enqueueRunListsService with the validated request", async () => {
		await request(app).post("/api/lists/run").send({
			steam_id: "76561198000000000",
			checkGamivoOffer: false,
		});

		expect(mockEnqueueRunListsService).toHaveBeenCalledOnce();
		expect(mockEnqueueRunListsService).toHaveBeenCalledWith(
			expect.objectContaining({
				steam_id: "76561198000000000",
				checkGamivoOffer: false,
			}),
		);
	});

	it("uses checkGamivoOffer=true as default when omitted", async () => {
		const res = await request(app).post("/api/lists/run").send({
			steam_id: "76561198000000000",
		});

		expect(res.status).toBe(202);
		expect(mockEnqueueRunListsService).toHaveBeenCalledWith(
			expect.objectContaining({ checkGamivoOffer: true }),
		);
	});

	it("returns 400 when steam_id is missing", async () => {
		const res = await request(app).post("/api/lists/run").send({});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when extra fields are sent (strict schema)", async () => {
		const res = await request(app).post("/api/lists/run").send({
			steam_id: "76561198000000000",
			unknownField: "x",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 500 when enqueueRunListsService throws", async () => {
		mockEnqueueRunListsService.mockRejectedValueOnce(new Error("Queue failure"));

		const res = await request(app).post("/api/lists/run").send({
			steam_id: "76561198000000000",
		});

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});
});
