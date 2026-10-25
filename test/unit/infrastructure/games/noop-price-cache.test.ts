import { describe, expect, it } from "vitest";
import { NoopPriceCache } from "@/infrastructure/games/noop-price-cache.js";

describe("NoopPriceCache", () => {
	it("misses everything and reports itself as disabled, not down", async () => {
		const cache = new NoopPriceCache();
		await cache.set(new Map([["a", { status: "not-found" }]]));

		expect(await cache.get(["a"])).toEqual(new Map());
		expect(await cache.status()).toBe("disabled");
	});
});
