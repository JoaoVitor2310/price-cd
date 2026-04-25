import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockAxiosPost } = vi.hoisted(() => ({
	mockAxiosPost: vi.fn(),
}));

vi.mock("axios", () => ({
	default: { post: mockAxiosPost },
}));

import { AxiosRunListsCallbackPoster } from "@/infrastructure/http/axios-run-lists-callback-poster.js";

const payload = { status: "completed" as const, result: "some result" };
const callbackUrl = "https://sistema-estoque.com/webhook/price";

describe("AxiosRunListsCallbackPoster", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockAxiosPost.mockResolvedValue({ status: 200 });
	});

	afterEach(() => {
		delete process.env.EXTERNAL_SECRET;
	});

	it("sends Authorization Bearer header when EXTERNAL_SECRET is set", async () => {
		process.env.EXTERNAL_SECRET = "my-secret-token";
		const poster = new AxiosRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		expect(mockAxiosPost).toHaveBeenCalledWith(
			callbackUrl,
			payload,
			expect.objectContaining({
				headers: { Authorization: "Bearer my-secret-token" },
			}),
		);
	});

	it("sends request without Authorization header when EXTERNAL_SECRET is not set", async () => {
		const poster = new AxiosRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		expect(mockAxiosPost).toHaveBeenCalledWith(
			callbackUrl,
			payload,
			expect.objectContaining({
				headers: {},
			}),
		);
	});

	it("posts to the correct callback URL", async () => {
		process.env.EXTERNAL_SECRET = "token";
		const poster = new AxiosRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		expect(mockAxiosPost).toHaveBeenCalledWith(callbackUrl, payload, expect.anything());
	});

	it("uses default timeout of 30000ms", async () => {
		const poster = new AxiosRunListsCallbackPoster();

		await poster.postCallback(callbackUrl, payload);

		expect(mockAxiosPost).toHaveBeenCalledWith(
			callbackUrl,
			payload,
			expect.objectContaining({ timeout: 30_000 }),
		);
	});

	it("respects custom timeoutMs option", async () => {
		const poster = new AxiosRunListsCallbackPoster({ timeoutMs: 5_000 });

		await poster.postCallback(callbackUrl, payload);

		expect(mockAxiosPost).toHaveBeenCalledWith(
			callbackUrl,
			payload,
			expect.objectContaining({ timeout: 5_000 }),
		);
	});

	it("does not throw when axios.post rejects", async () => {
		mockAxiosPost.mockRejectedValueOnce(new Error("Network error"));
		const poster = new AxiosRunListsCallbackPoster();

		await expect(poster.postCallback(callbackUrl, payload)).resolves.toBeUndefined();
	});
});
