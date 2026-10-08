import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/helpers/utils.js", () => ({
	delay: vi.fn().mockResolvedValue(undefined),
}));

import { gotoWithRetry } from "@/lib/puppeteer-goto-with-retry.js";
import { delay } from "@/helpers/utils.js";
import { TimeoutError } from "puppeteer";
import type { PageWithCursor } from "puppeteer-real-browser";

afterEach(() => {
	vi.mocked(delay).mockClear();
});

const makeResponse = (status: number, headers: Record<string, string> = {}) => ({
	status: () => status,
	headers: () => headers,
});

const makePage = (goto: (...args: unknown[]) => unknown) =>
	({ goto } as unknown as PageWithCursor);

describe("gotoWithRetry", () => {
	it("returns true on a successful first navigation", async () => {
		const gotoMock = vi.fn().mockResolvedValue(makeResponse(200));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com");

		expect(result).toBe(true);
		expect(gotoMock).toHaveBeenCalledTimes(1);
	});

	it("retries after a 429 and succeeds on the next attempt", async () => {
		const gotoMock = vi.fn()
			.mockResolvedValueOnce(makeResponse(429))
			.mockResolvedValueOnce(makeResponse(200));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com", 3);

		expect(result).toBe(true);
		expect(gotoMock).toHaveBeenCalledTimes(2);
	});

	it("respects the retry-after header on a 429 response", async () => {
		const gotoMock = vi.fn()
			.mockResolvedValueOnce(makeResponse(429, { "retry-after": "3" }))
			.mockResolvedValueOnce(makeResponse(200));
		const page = makePage(gotoMock);

		await gotoWithRetry(page, "https://example.com", 3);

		expect(delay).toHaveBeenCalledWith(3000);
	});

	it("returns false when every attempt gets a 429", async () => {
		const gotoMock = vi.fn().mockResolvedValue(makeResponse(429));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com", 2);

		expect(result).toBe(false);
		expect(gotoMock).toHaveBeenCalledTimes(2);
	});

	it("retries on TimeoutError and returns false once retries are exhausted", async () => {
		const gotoMock = vi.fn().mockRejectedValue(new TimeoutError("timed out"));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com", 2);

		expect(result).toBe(false);
		expect(gotoMock).toHaveBeenCalledTimes(2);
	});

	it("returns true if a later attempt succeeds after a TimeoutError", async () => {
		const gotoMock = vi.fn()
			.mockRejectedValueOnce(new TimeoutError("timed out"))
			.mockResolvedValueOnce(makeResponse(200));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com", 3);

		expect(result).toBe(true);
		expect(gotoMock).toHaveBeenCalledTimes(2);
	});

	it("returns false immediately on a non-timeout error, without retrying", async () => {
		const gotoMock = vi.fn().mockRejectedValue(new Error("some other failure"));
		const page = makePage(gotoMock);

		const result = await gotoWithRetry(page, "https://example.com", 3);

		expect(result).toBe(false);
		expect(gotoMock).toHaveBeenCalledTimes(1);
	});

	describe("diagnosis when navigation gives up", () => {
		const makeLivePage = (goto: (...args: unknown[]) => unknown, html: string) =>
			({ goto, content: async () => html, url: () => "https://example.com/stuck" }) as unknown as PageWithCursor;

		const diagnosisLines = (spy: ReturnType<typeof vi.spyOn>) =>
			spy.mock.calls.map((call) => String(call[0])).filter((line) => line.includes("[DIAGNOSIS]"));

		it("logs what the page looked like after the timeouts are exhausted", async () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const challenge = `<html><head><title>Just a moment...</title></head><body>${"x".repeat(2000)}</body></html>`;
			const page = makeLivePage(vi.fn().mockRejectedValue(new TimeoutError("timed out")), challenge);

			await gotoWithRetry(page, "https://example.com/stuck", 2);

			const lines = diagnosisLines(errorSpy);
			expect(lines).toHaveLength(1);
			expect(lines[0]).toContain("https://example.com/stuck");
			expect(lines[0]).toMatch(/Cloudflare challenge/);
			errorSpy.mockRestore();
		});

		it("logs the diagnosis when every attempt got a 429", async () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const page = makeLivePage(vi.fn().mockResolvedValue(makeResponse(429)), "<html></html>");

			await gotoWithRetry(page, "https://example.com/stuck", 2);

			expect(diagnosisLines(errorSpy)).toHaveLength(1);
			errorSpy.mockRestore();
		});

		it("reports a hung browser instead of blocking the caller", async () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			const page = {
				goto: vi.fn().mockRejectedValue(new Error("boom")),
				content: () => new Promise<string>(() => {}),
				url: () => "about:blank",
			} as unknown as PageWithCursor;

			vi.useFakeTimers();
			const pending = gotoWithRetry(page, "https://example.com/stuck", 1);
			await vi.advanceTimersByTimeAsync(3_000);
			await pending;
			vi.useRealTimers();

			expect(diagnosisLines(errorSpy)[0]).toMatch(/Chromium hung/);
			errorSpy.mockRestore();
		});

		it("does not read the page when the navigation succeeds", async () => {
			const content = vi.fn();
			const page = { goto: vi.fn().mockResolvedValue(makeResponse(200)), content, url: () => "" } as unknown as PageWithCursor;

			await gotoWithRetry(page, "https://example.com");

			expect(content).not.toHaveBeenCalled();
		});

		it("does not diagnose a failure it recovered from", async () => {
			const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const goto = vi.fn().mockRejectedValueOnce(new TimeoutError("timed out")).mockResolvedValueOnce(makeResponse(200));
			const page = makeLivePage(goto, "<html></html>");

			await gotoWithRetry(page, "https://example.com", 3);

			expect(diagnosisLines(errorSpy)).toHaveLength(0);
			errorSpy.mockRestore();
		});
	});
});
