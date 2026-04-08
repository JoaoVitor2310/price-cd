import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
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

const uploadsDir = path.resolve(process.cwd(), "uploads");

const makeGame = (overrides: Partial<FoundGames> = {}): FoundGames => ({
	id: 0,
	name: "Half-Life",
	id_steam: "70",
	popularity: 500,
	region: "global",
	GamivoPrice: "4,50",
	...overrides,
});

/** Builds a Buffer representing a valid .txt upload file. */
const makeTxt = (minPopularity: number, ...games: string[]) =>
	Buffer.from([String(minPopularity), ...games].join("\n"));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/upload", () => {
	beforeAll(() => {
		fs.mkdirSync(uploadsDir, { recursive: true });
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns a file download on happy path", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", makeTxt(100, "Half-Life"), {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(200);
		expect(res.headers["content-disposition"]).toMatch(/attachment/);
		expect(res.headers["content-disposition"]).toMatch(/games-result\.txt/);
	});

	it("returns file content with the expected tab-separated format", async () => {
		const game = makeGame();
		mockPopularityFetch.mockResolvedValueOnce([game]);
		mockPriceFetch.mockResolvedValueOnce([game]);

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", makeTxt(100, "Half-Life"), {
				filename: "games.txt",
				contentType: "text/plain",
			});

		// res.body is a Buffer because Express serves the temp file without extension
		// (content-type: application/octet-stream), so supertest stores body as Buffer
		const body = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.text;
		expect(body).toContain("Half-Life");
		expect(body).toContain("4,50");
	});

	it("uploads multiple games and returns all in the result file", async () => {
		const games = [
			makeGame({ id: 0, name: "Half-Life", GamivoPrice: "4,50" }),
			makeGame({ id: 1, name: "Portal", GamivoPrice: "3,00" }),
		];
		mockPopularityFetch.mockResolvedValueOnce(games);
		mockPriceFetch.mockResolvedValueOnce(games);

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", makeTxt(0, "Half-Life", "Portal"), {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(200);
		const body = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : res.text;
		expect(body).toContain("Half-Life");
		expect(body).toContain("Portal");
	});

	it("returns 400 when file content has no game names after filtering empty lines", async () => {
		// File has minPopularity line and only blank lines → gameNames will be [] → ZodError
		const content = Buffer.from("100\n   \n   \n");

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", content, {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when first line is not a valid number", async () => {
		const content = Buffer.from("not-a-number\nHalf-Life");

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", content, {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 400 when first line popularity is negative", async () => {
		const content = Buffer.from("-10\nHalf-Life");

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", content, {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(400);
		expect(res.body.success).toBe(false);
	});

	it("returns 500 when no file is attached", async () => {
		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false");

		expect(res.status).toBe(500);
		expect(res.body.success).toBe(false);
	});

	it("returns empty result file when no games pass popularity filter", async () => {
		mockPopularityFetch.mockResolvedValueOnce([makeGame({ popularity: 5 })]);

		const res = await request(app)
			.post("/api/upload")
			.field("checkGamivoOffer", "false")
			.attach("fileToUpload", makeTxt(100, "Obscure Game"), {
				filename: "games.txt",
				contentType: "text/plain",
			});

		expect(res.status).toBe(200);
		// File is sent but empty — no game lines
		const body = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : (res.text ?? "");
		expect(body.trim()).toBe("");
		expect(mockPriceFetch).not.toHaveBeenCalled();
	});
});
