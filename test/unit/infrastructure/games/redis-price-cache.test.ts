import { afterEach, describe, expect, it, vi } from "vitest";
import type { CachedPrice } from "@/application/games/ports/price-cache.port.js";
import {
	RedisPriceCache,
	type RedisPriceCacheClient,
} from "@/infrastructure/games/redis-price-cache.js";

const priced: CachedPrice = {
	status: "priced",
	price: {
		bestPrice: 4.99,
		hasGamivoOffer: true,
		gamivo_id: "123",
		foundName: "Hades",
	},
};

const fakeClient = (overrides: Partial<RedisPriceCacheClient> = {}) => ({
	mGet: vi.fn(async (keys: string[]) => keys.map(() => null as string | null)),
	set: vi.fn(async () => "OK"),
	ping: vi.fn(async () => "PONG"),
	close: vi.fn(async () => {}),
	...overrides,
});

const down = () => vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));

afterEach(() => {
	vi.restoreAllMocks();
});

describe("RedisPriceCache", () => {
	it("returns only the keys it found", async () => {
		const client = fakeClient({
			mGet: vi.fn(async () => [JSON.stringify(priced), null]),
		});

		const found = await new RedisPriceCache(client, 3600).get(["a", "b"]);

		expect([...found]).toEqual([["a", priced]]);
	});

	it("stores each entry as JSON with the configured TTL", async () => {
		const client = fakeClient();

		await new RedisPriceCache(client, 3600).set(new Map([["a", priced]]));

		expect(client.set).toHaveBeenCalledWith("a", JSON.stringify(priced), {
			expiration: { type: "EX", value: 3600 },
		});
	});

	it("treats an entry written in another shape as a miss, never as a price", async () => {
		// O Redis sobrevive ao deploy: o formato gravado pode ser de outra versão.
		const client = fakeClient({
			mGet: vi.fn(async () => [
				JSON.stringify({ status: "priced", price: { bestPrice: "4.99" } }),
				"not json",
			]),
		});

		const found = await new RedisPriceCache(client, 3600).get(["a", "b"]);

		expect(found.size).toBe(0);
	});

	it("does not call Redis for empty input", async () => {
		const client = fakeClient();
		const cache = new RedisPriceCache(client, 3600);

		await cache.get([]);
		await cache.set(new Map());

		expect(client.mGet).not.toHaveBeenCalled();
		expect(client.set).not.toHaveBeenCalled();
	});

	describe("fail-open", () => {
		it("turns a failed read into a miss instead of throwing", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const cache = new RedisPriceCache(fakeClient({ mGet: down() }), 3600);

			await expect(cache.get(["a"])).resolves.toEqual(new Map());
		});

		it("ignores a failed write instead of throwing", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const cache = new RedisPriceCache(fakeClient({ set: down() }), 3600);

			await expect(
				cache.set(new Map([["a", priced]])),
			).resolves.toBeUndefined();
		});

		it("warns once when Redis goes down, not once per game", async () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const cache = new RedisPriceCache(
				fakeClient({ mGet: down(), set: down() }),
				3600,
			);

			await cache.get(["a"]);
			await cache.get(["b"]);
			await cache.set(new Map([["a", priced]]));

			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("[CACHE] Redis read failed"),
			);
		});

		it("says so when Redis comes back", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			const mGet = vi
				.fn()
				.mockRejectedValueOnce(new Error("down"))
				.mockResolvedValue([null]);
			const cache = new RedisPriceCache(fakeClient({ mGet }), 3600);

			await cache.get(["a"]);
			await cache.get(["a"]);

			expect(log).toHaveBeenCalledWith(
				expect.stringContaining("responding again"),
			);
		});
	});

	describe("status", () => {
		it("is up when Redis answers the ping", async () => {
			expect(await new RedisPriceCache(fakeClient(), 3600).status()).toBe("up");
		});

		it("is down when it does not", async () => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const cache = new RedisPriceCache(fakeClient({ ping: down() }), 3600);

			expect(await cache.status()).toBe("down");
		});
	});

	it("closes the client on shutdown, and never throws doing it", async () => {
		const client = fakeClient({
			close: vi.fn().mockRejectedValue(new Error("already closed")),
		});

		await expect(
			new RedisPriceCache(client, 3600).onApplicationShutdown(),
		).resolves.toBeUndefined();
		expect(client.close).toHaveBeenCalled();
	});
});
