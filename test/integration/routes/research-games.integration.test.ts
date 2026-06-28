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

const INTERNAL_SECRET = "test-internal-secret";

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
// Authenticated mode (valid token → results sent to Sistema Estoque)
// ---------------------------------------------------------------------------

describe("POST /api/games/research — authenticated mode", () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeAll(() => {
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque";
		process.env.EXTERNAL_SECRET = "test-secret";
		process.env.INTERNAL_SECRET = INTERNAL_SECRET;
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns { success: true } with no demo flag", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Half-Life"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

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
			.send({ content: makeContent(0, "Half-Life", "Portal"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

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
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET, steam_id: "76561198000000001", list_code: "G0eXM" });

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
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

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
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("http://sistema-estoque/trades/from-price-researcher");
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-secret");
	});

	it("returns 200 without calling Sistema Estoque when no game passes popularity filter", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame({ popularity: 5 })]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Obscure Game"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

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
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, internal_secret: INTERNAL_SECRET });

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Demo mode (no token or wrong token → JSON response, max 10 games)
// ---------------------------------------------------------------------------

describe("POST /api/games/research — demo mode", () => {
	beforeAll(() => {
		process.env.INTERNAL_SECRET = INTERNAL_SECRET;
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns { success: true, demo: true, games: [...] } when no token is sent", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Half-Life"), checkGamivoOffer: false });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.demo).toBe(true);
		expect(res.body.games).toMatchObject([{ name: "Half-Life", price_euro: 4.5 }]);
	});

	it("returns demo mode when token is wrong", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, "Half-Life"), checkGamivoOffer: false, internal_secret: "wrong-token" });

		expect(res.status).toBe(200);
		expect(res.body.demo).toBe(true);
	});

	it("limits input to 10 games in demo mode", async () => {
		const games = Array.from({ length: 15 }, (_, i) => makeGame({ id: i, name: `Game ${i}` }));
		mockPopularityFetch.mockResolvedValueOnce(games.slice(0, 10));
		mockPriceFetch.mockResolvedValueOnce(games.slice(0, 10));

		const gameNames = games.map((g) => g.name);
		await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(0, ...gameNames), checkGamivoOffer: false });

		const [calledNames] = mockPopularityFetch.mock.calls[0] as [string[], number];
		expect(calledNames.length).toBeLessThanOrEqual(10);
	});

	it("returns empty games array when no game passes popularity filter", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame({ popularity: 5 })]);

		const res = await request(app)
			.post("/api/games/research")
			.send({ content: makeContent(100, "Obscure Game"), checkGamivoOffer: false });

		expect(res.status).toBe(200);
		expect(res.body.demo).toBe(true);
		expect(res.body.games).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Validation (both modes)
// ---------------------------------------------------------------------------

describe("POST /api/games/research — validation", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns 400 when content is missing", async () => {
		const res = await request(app)
			.post("/api/games/research")
			.send({ checkGamivoOffer: false });

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when content has no game names after the popularity line", async () => {
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
