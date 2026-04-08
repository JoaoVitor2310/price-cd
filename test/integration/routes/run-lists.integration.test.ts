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
			id_steam: "76561198000000000",
			callback_url: "https://example.com/callback",
			checkGamivoOffer: true,
		});

		expect(res.status).toBe(202);
		expect(res.body).toEqual({ success: true, status: "queued" });
	});

	it("calls enqueueRunListsService with the validated request", async () => {
		await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
			callback_url: "https://example.com/callback",
			checkGamivoOffer: false,
		});

		expect(mockEnqueueRunListsService).toHaveBeenCalledOnce();
		expect(mockEnqueueRunListsService).toHaveBeenCalledWith(
			expect.objectContaining({
				id_steam: "76561198000000000",
				callback_url: "https://example.com/callback",
				checkGamivoOffer: false,
			}),
		);
	});

	it("uses checkGamivoOffer=true as default when omitted", async () => {
		const res = await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
			callback_url: "https://example.com/callback",
		});

		expect(res.status).toBe(202);
		expect(mockEnqueueRunListsService).toHaveBeenCalledWith(
			expect.objectContaining({ checkGamivoOffer: true }),
		);
	});

	it("returns 400 when id_steam is missing", async () => {
		const res = await request(app).post("/api/lists/run").send({
			callback_url: "https://example.com/callback",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when callback_url is missing", async () => {
		const res = await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when callback_url is not a valid URL", async () => {
		const res = await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
			callback_url: "not-a-url",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when extra fields are sent (strict schema)", async () => {
		const res = await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
			callback_url: "https://example.com/callback",
			unknownField: "x",
		});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 500 when enqueueRunListsService throws", async () => {
		mockEnqueueRunListsService.mockRejectedValueOnce(new Error("Queue failure"));

		const res = await request(app).post("/api/lists/run").send({
			id_steam: "76561198000000000",
			callback_url: "https://example.com/callback",
		});

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});
});
