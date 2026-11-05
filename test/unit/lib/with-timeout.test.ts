import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/lib/with-timeout.js";

afterEach(() => {
	vi.useRealTimers();
});

describe("withTimeout", () => {
	it("resolves with the value when the promise settles in time", async () => {
		await expect(withTimeout(Promise.resolve("PONG"), 1000)).resolves.toBe(
			"PONG",
		);
	});

	it("passes the original rejection through", async () => {
		await expect(
			withTimeout(Promise.reject(new Error("Connection is closed.")), 1000),
		).rejects.toThrow("Connection is closed.");
	});

	it("rejects once the time is up, without waiting for the promise", async () => {
		vi.useFakeTimers();
		const pending = withTimeout(new Promise(() => {}), 500);
		const assertion = expect(pending).rejects.toThrow("timed out after 500ms");

		await vi.advanceTimersByTimeAsync(500);
		await assertion;
	});

	it("leaves no timer behind when the promise wins", async () => {
		vi.useFakeTimers();

		await withTimeout(Promise.resolve(1), 500);

		expect(vi.getTimerCount()).toBe(0);
	});
});
