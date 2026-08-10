import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetTopicsFromPage } = vi.hoisted(() => ({
	mockGetTopicsFromPage: vi.fn<() => Promise<Array<{ code: string; url: string; isClosed: boolean }>>>(),
}));

vi.mock("@/infrastructure/suppliers/puppeteer-trade-paginator.js", () => ({
	PuppeteerTradePaginator: vi.fn().mockImplementation(() => ({
		getTopicsFromPage: mockGetTopicsFromPage,
	})),
}));

vi.mock("@/infrastructure/suppliers/puppeteer-topic-scraper.js", () => ({
	PuppeteerTopicScraper: vi.fn().mockImplementation(() => ({
		scrape: vi.fn(),
	})),
}));

vi.mock("@/infrastructure/suppliers/puppeteer-comment-poster.js", () => ({
	PuppeteerCommentPoster: vi.fn().mockImplementation(() => ({
		post: vi.fn(),
	})),
}));

vi.mock("@/infrastructure/suppliers/http-profitability-checker.js", () => ({
	HttpProfitabilityChecker: vi.fn().mockImplementation(() => ({
		evaluate: vi.fn(),
	})),
}));

vi.mock("@/lib/puppeteer-browser.js", () => ({
	getSuppliersSession: vi.fn().mockResolvedValue({
		page: { browserContext: () => ({ setCookie: vi.fn().mockResolvedValue(undefined) }) },
	}),
	cleanupSuppliersSession: vi.fn().mockResolvedValue(undefined),
}));

import app from "@/app.js";
import { TF2_SEARCH_TERMS } from "@/domain/suppliers/tf2-key-matching.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A varredura roda em background. Cede o event loop para a task rodar antes das asserções.
 */
const flushBackgroundTasks = () => new Promise((resolve) => setImmediate(resolve));

// ---------------------------------------------------------------------------

describe("POST /api/suppliers/find-new", () => {
	beforeAll(() => {
		process.env.STEAMTRADES_SESSION = "test-session-cookie";
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque";
		process.env.EXTERNAL_SECRET = "test-secret";
	});

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns 202 queued without waiting for the scan to finish", async () => {
		const resolvers: Array<(topics: Array<{ code: string; url: string; isClosed: boolean }>) => void> = [];
		mockGetTopicsFromPage.mockImplementation(
			() => new Promise((resolve) => {
				resolvers.push(resolve);
			}),
		);

		const res = await request(app).post("/api/suppliers/find-new").send();

		expect(res.status).toBe(202);
		expect(res.body).toEqual({ success: true, status: "queued" });
		// A varredura ainda não terminou — a página nunca respondeu.
		expect(mockGetTopicsFromPage).toHaveBeenCalledTimes(1);

		// Libera uma busca (termo) por vez até a task em background terminar de fato —
		// senão ela fica presa ocupando a única vaga do scheduler (concorrência 1) e
		// trava os testes seguintes, que nunca chegam a rodar.
		for (let i = 0; i < TF2_SEARCH_TERMS.length; i++) {
			resolvers.shift()?.([]);
			await flushBackgroundTasks();
		}
	});

	it("runs the scan in the background and stops when a page has no topics", async () => {
		mockGetTopicsFromPage.mockResolvedValue([]);

		await request(app).post("/api/suppliers/find-new").send();
		await flushBackgroundTasks();

		expect(mockGetTopicsFromPage).toHaveBeenCalledTimes(TF2_SEARCH_TERMS.length);
	});

	it("logs but does not surface an error when the background scan fails", async () => {
		mockGetTopicsFromPage.mockRejectedValueOnce(new Error("SteamTrades unreachable"));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		const res = await request(app).post("/api/suppliers/find-new").send();
		await flushBackgroundTasks();

		expect(res.status).toBe(202);
		expect(consoleError).toHaveBeenCalled();

		consoleError.mockRestore();
	});

	it("returns 500 without queuing when a required env var is missing", async () => {
		const original = process.env.STEAMTRADES_SESSION;
		process.env.STEAMTRADES_SESSION = "";

		const res = await request(app).post("/api/suppliers/find-new").send();

		expect(res.status).toBe(500);
		expect(res.body.error).toMatch(/STEAMTRADES_SESSION/);
		expect(mockGetTopicsFromPage).not.toHaveBeenCalled();

		process.env.STEAMTRADES_SESSION = original;
	});
});
