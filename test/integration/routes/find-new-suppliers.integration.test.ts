import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import request from "supertest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockGetTopicsFromPage } = vi.hoisted(() => ({
	mockGetTopicsFromPage: vi.fn<() => Promise<Array<{ code: string; url: string }>>>(),
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
		let resolveTopics: ((topics: Array<{ code: string; url: string }>) => void) | undefined;
		mockGetTopicsFromPage.mockImplementation(
			() => new Promise((resolve) => {
				resolveTopics = resolve;
			}),
		);

		const res = await request(app).post("/api/suppliers/find-new").send();

		expect(res.status).toBe(202);
		expect(res.body).toEqual({ success: true, status: "queued" });
		// A varredura ainda não terminou — a página nunca respondeu.
		expect(mockGetTopicsFromPage).toHaveBeenCalledTimes(1);

		resolveTopics?.([]);
		await flushBackgroundTasks();
	});

	it("runs the scan in the background and stops when a page has no topics", async () => {
		mockGetTopicsFromPage.mockResolvedValueOnce([]);

		await request(app).post("/api/suppliers/find-new").send();
		await flushBackgroundTasks();

		expect(mockGetTopicsFromPage).toHaveBeenCalledTimes(1);
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
