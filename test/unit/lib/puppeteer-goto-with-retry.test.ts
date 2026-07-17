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
});
