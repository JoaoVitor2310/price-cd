import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { FoundGames } from "@/application/games/game.types.js";

// ---------------------------------------------------------------------------
// Mocks (hoisted so they exist before module-level singletons are created)
// ---------------------------------------------------------------------------

const { mockPopularityFetch, mockPriceFetch } = vi.hoisted(() => ({
	mockPopularityFetch: vi.fn<() => Promise<FoundGames[]>>(),
	mockPriceFetch: vi.fn<() => Promise<FoundGames[]>>(),
}));

vi.mock("@/infrastructure/games/steam-charts-popularity-fetcher.js", () => ({
	SteamChartsPopularityFetcher: vi.fn().mockImplementation(() => ({
		fetch: mockPopularityFetch,
	})),
}));

vi.mock("@/infrastructure/games/allkeyshop-price-fetcher.js", () => ({
	AllKeyShopPriceFetcher: vi.fn().mockImplementation(() => ({
		fetch: mockPriceFetch,
	})),
}));

import app from "@/app.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeGame = (overrides: Partial<FoundGames> = {}): FoundGames => ({
	id: 0,
	name: "Half-Life",
	id_steam: "70",
	popularity: 500,
	region: "global",
	GamivoPrice: "4,50",
	...overrides,
});

const validBody = {
	gameNames: ["Half-Life"],
	minPopularity: 100,
	checkGamivoOffer: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/games/search", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 200 with found games on happy path", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app).post("/api/games/search").send(validBody);

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.games).toHaveLength(1);
		expect(res.body.data.games[0].name).toBe("Half-Life");
		expect(res.body.data.games[0].GamivoPrice).toBe("4,50");
	});

	it("returns correct summary fields", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app).post("/api/games/search").send(validBody);

		const { summary } = res.body.data;
		expect(summary.totalRequested).toBe(1);
		expect(summary.foundGames).toBe(1);
		expect(summary.worthyByPopularity).toBe(1);
		expect(summary.foundPrices).toBe(1);
		expect(typeof summary.processingTimeSeconds).toBe("number");
	});

	it("filters out games below minPopularity and skips price fetcher", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame({ popularity: 5 })]);

		const res = await request(app)
			.post("/api/games/search")
			.send({ ...validBody, minPopularity: 100 });

		expect(res.status).toBe(200);
		expect(res.body.data.games).toHaveLength(0);
		expect(res.body.data.summary.worthyByPopularity).toBe(0);
		expect(mockPriceFetch).not.toHaveBeenCalled();
	});

	it("skips price fetcher when popularity fetcher returns empty", async () => {
		mockPopularityFetch.mockResolvedValueOnce([]);

		const res = await request(app).post("/api/games/search").send(validBody);

		expect(res.status).toBe(200);
		expect(mockPriceFetch).not.toHaveBeenCalled();
	});

	it("deduplicates game names before calling popularity fetcher", async () => {
		mockPopularityFetch.mockResolvedValueOnce([]);

		await request(app)
			.post("/api/games/search")
			.send({ ...validBody, gameNames: ["Half-Life", "Half-Life", "Portal"] });

		const calledWith = mockPopularityFetch.mock.calls[0][0] as string[];
		expect(calledWith).toHaveLength(2);
		expect(new Set(calledWith).size).toBe(2);
	});

	it("passes checkGamivoOffer=true to price fetcher", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		await request(app)
			.post("/api/games/search")
			.send({ ...validBody, checkGamivoOffer: true });

		expect(mockPriceFetch).toHaveBeenCalledWith(expect.any(Array), true);
	});

	it("returns 400 when gameNames is missing", async () => {
		const res = await request(app)
			.post("/api/games/search")
			.send({ minPopularity: 50, checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
		expect(res.body.error).toBe("Validation failed");
	});

	it("returns 400 when gameNames is empty array", async () => {
		const res = await request(app)
			.post("/api/games/search")
			.send({ gameNames: [], minPopularity: 50, checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when minPopularity is negative", async () => {
		const res = await request(app)
			.post("/api/games/search")
			.send({ gameNames: ["Half-Life"], minPopularity: -1, checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when checkGamivoOffer is missing", async () => {
		const res = await request(app)
			.post("/api/games/search")
			.send({ gameNames: ["Half-Life"], minPopularity: 0 });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when extra fields are sent (strict schema)", async () => {
		const res = await request(app)
			.post("/api/games/search")
			.send({ ...validBody, unknownField: "x" });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 500 when popularity fetcher throws", async () => {
		mockPopularityFetch.mockRejectedValueOnce(new Error("SteamCharts unavailable"));

		const res = await request(app).post("/api/games/search").send(validBody);

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});

	it("returns 500 when price fetcher throws", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame()]);
		mockPriceFetch.mockRejectedValueOnce(new Error("AllKeyShop unavailable"));

		const res = await request(app).post("/api/games/search").send(validBody);

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});
});
