import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FetchRunListsCallbackPoster } from "@/infrastructure/http/fetch-run-lists-callback-poster.js";

const payload = { status: "completed" as const, result: "some result" };
const callbackUrl = "https://sistema-estoque.com/webhook/price";

describe("FetchRunListsCallbackPoster", () => {
	let mockFetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.EXTERNAL_SECRET;
	});

	it("sends Authorization Bearer header when EXTERNAL_SECRET is set", async () => {
		process.env.EXTERNAL_SECRET = "my-secret-token";
		const poster = new FetchRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-secret-token");
	});

	it("sends request without Authorization header when EXTERNAL_SECRET is not set", async () => {
		const poster = new FetchRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Authorization"]).toBeUndefined();
	});

	it("posts to the correct callback URL", async () => {
		const poster = new FetchRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		expect(mockFetch).toHaveBeenCalledWith(callbackUrl, expect.anything());
	});

	it("sends Content-Type application/json", async () => {
		const poster = new FetchRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
	});

	it("sends JSON-serialized payload as body", async () => {
		const poster = new FetchRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
		expect(init.body).toBe(JSON.stringify(payload));
	});

	it("aborts the request after custom timeoutMs", async () => {
		vi.useFakeTimers();
		mockFetch.mockImplementation((_url: string, init: RequestInit) =>
			new Promise((_, reject) => {
				(init.signal as AbortSignal).addEventListener("abort", () =>
					reject(new DOMException("Aborted", "AbortError")),
				);
			}),
		);

		const poster = new FetchRunListsCallbackPoster({ timeoutMs: 5_000 });
		const promise = poster.postCallback(callbackUrl, payload);

		vi.advanceTimersByTime(5_000);
		await promise;

		vi.useRealTimers();
	});

	it("does not throw when fetch rejects", async () => {
		mockFetch.mockRejectedValueOnce(new Error("Network error"));
		const poster = new FetchRunListsCallbackPoster();

		await expect(poster.postCallback(callbackUrl, payload)).resolves.toBeUndefined();
	});
});
