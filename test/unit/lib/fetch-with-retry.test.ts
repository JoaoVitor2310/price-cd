import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/helpers/utils.js", () => ({
	delay: vi.fn().mockResolvedValue(undefined),
}));

import { fetchWithRetry } from "@/lib/fetch-with-retry.js";
import { delay } from "@/helpers/utils.js";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.mocked(delay).mockClear();
});

describe("fetchWithRetry", () => {
	it("returns response text on first successful attempt", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "hello" });
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchWithRetry("https://example.com");

		expect(result).toBe("hello");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("retries after a 429 and succeeds on the next attempt", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null } })
			.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" });
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchWithRetry("https://example.com", 3, 100);

		expect(result).toBe("ok");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("respects the Retry-After header when present", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => "2" } })
			.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" });
		vi.stubGlobal("fetch", fetchMock);

		await fetchWithRetry("https://example.com");

		expect(delay).toHaveBeenCalledWith(2000);
	});

	it("uses exponential backoff based on baseDelay when there is no Retry-After header", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null } })
			.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" });
		vi.stubGlobal("fetch", fetchMock);

		await fetchWithRetry("https://example.com", 3, 4000);

		// attempt 1: 2^0 * (4000/1000) = 4s → 4000ms
		expect(delay).toHaveBeenCalledWith(4000);
	});

	it("retries on other non-ok statuses with a fixed 1.5s delay", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 503, headers: { get: () => null } })
			.mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok" });
		vi.stubGlobal("fetch", fetchMock);

		await fetchWithRetry("https://example.com");

		expect(delay).toHaveBeenCalledWith(1500);
	});

	it("throws after exhausting all retries", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, headers: { get: () => null } });
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchWithRetry("https://example.com", 2)).rejects.toThrow("Failed after 2 attempts");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("propagates immediately when fetch itself throws (no retry)", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
		vi.stubGlobal("fetch", fetchMock);

		await expect(fetchWithRetry("https://example.com", 3)).rejects.toThrow("network down");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
