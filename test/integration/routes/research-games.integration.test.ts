import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";
import type { FoundGames } from "@/application/games/game.types.js";

// ---------------------------------------------------------------------------
// Mocks
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
// Helpers
// ---------------------------------------------------------------------------

const makeGame = (overrides: Partial<FoundGames> = {}): FoundGames => ({
	id: 0,
	name: "Half-Life",
	id_steam: "70",
	popularity: 500,
	region: "global",
	GamivoPrice: 4.5,
	...overrides,
});

const makeContent = (minPopularity: number, ...games: string[]) =>
	[String(minPopularity), ...games].join("\n");


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/games/research", () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque";
		process.env.EXTERNAL_SECRET = "test-secret";
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns 200 on happy path", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Half-Life"), checkGamivoOffer: false });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true });
	});

	it("sends all priced games to Sistema Estoque", async () => {
		const games = [
			makeGame({ id: 0, name: "Half-Life", GamivoPrice: 4.5, popularity: 500, region: "global" }),
			makeGame({ id: 1, name: "Portal", GamivoPrice: 3.0, popularity: 800, region: "eu" }),
		];
		mockPopularityFetch.mockResolvedValueOnce(games);
		mockPriceFetch.mockResolvedValueOnce(games);

		await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life", "Portal"), checkGamivoOffer: false });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.games).toHaveLength(2);
		expect(body.games[0]).toMatchObject({ name: "Half-Life", price_euro: 4.5, popularity: 500, region: "global" });
		expect(body.games[1]).toMatchObject({ name: "Portal", price_euro: 3.0, popularity: 800, region: "eu" });
	});

	it("forwards optional steam_id and list_code to Sistema Estoque when provided", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, steam_id: "76561198000000001", list_code: "G0eXM" });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.supplier_steam_id).toBe("76561198000000001");
		expect(body.list_code).toBe("G0eXM");
	});

	it("does not include supplier_steam_id or list_code when not provided", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false });

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		const body = JSON.parse(init.body as string);
		expect(body.supplier_steam_id).toBeUndefined();
		expect(body.list_code).toBeUndefined();
	});

	it("sends correct endpoint URL and Authorization header", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false });

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://sistema-estoque/trades/from-price-researcher");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-secret");
	});

	it("returns 200 with null data when no games have a price", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame({ popularity: 5 })]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Obscure Game"), checkGamivoOffer: false });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true });
		expect(mockFetch).not.toHaveBeenCalled();
		expect(mockPriceFetch).not.toHaveBeenCalled();
	});

	it("returns 500 when Sistema Estoque call fails", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);
		mockFetch.mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false });

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when content is missing", async () => {
		const res = await request(app)
			.post("/api/games/research")
			.send({ checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when file content has no game names after filtering empty lines", async () => {
		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100), checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when first line is not a valid number", async () => {
		const res = await request(app)
			.post("/api/games/research")
			.send({ content: "not-a-number\nHalf-Life", checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when first line popularity is negative", async () => {
		const res = await request(app)
			.post("/api/games/research")
			.send({ content: "-10\nHalf-Life", checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});
});
