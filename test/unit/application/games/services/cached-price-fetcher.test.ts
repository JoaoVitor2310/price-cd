import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	CatalogPrice,
	CatalogPriceSource,
	PriceLookup,
} from "@/application/games/ports/game-search.ports.js";
import type {
	CachedPrice,
	PriceCache,
} from "@/application/games/ports/price-cache.port.js";
import {
	CachedPriceFetcher,
	priceCacheKey,
} from "@/application/games/services/cached-price-fetcher.js";

const game = (name: string, id = 1): FoundGames => ({
	id,
	name,
	id_steam: "1145360",
	popularity: 500,
});

const catalog = (overrides: Partial<CatalogPrice> = {}): CatalogPrice => ({
	bestPrice: 4.99,
	hasGamivoOffer: true,
	gamivo_id: "123",
	foundName: "Hades",
	...overrides,
});

const priced = (overrides: Partial<CatalogPrice> = {}): CachedPrice => ({
	status: "priced",
	price: catalog(overrides),
});

/** Cache em memória que registra o que foi gravado. */
const fakeCache = (initial: Record<string, CachedPrice> = {}) => {
	const store = new Map(Object.entries(initial));
	return {
		store,
		get: vi.fn(async (keys: string[]) => {
			const found = new Map<string, CachedPrice>();
			for (const key of keys) {
				const entry = store.get(key);
				if (entry) found.set(key, entry);
			}
			return found;
		}),
		set: vi.fn(async (entries: Map<string, CachedPrice>) => {
			for (const [key, value] of entries) store.set(key, value);
		}),
		status: vi.fn(async () => "up" as const),
	};
};

const fakeSource = (results: Record<string, PriceLookup>) => ({
	lookup: vi.fn(async (names: string[]) => {
		const found = new Map<string, PriceLookup>();
		for (const name of names) {
			if (results[name]) found.set(name, results[name]);
		}
		return found;
	}),
});

const build = (
	source: ReturnType<typeof fakeSource>,
	cache: ReturnType<typeof fakeCache>,
) =>
	new CachedPriceFetcher(
		source as unknown as CatalogPriceSource,
		cache as unknown as PriceCache,
	);

describe("priceCacheKey", () => {
	it("separates regions", () => {
		expect(priceCacheKey("Crysis 2 EU")).not.toBe(priceCacheKey("Crysis 2"));
	});

	it("separates editions, so a remaster never reads the original's price", () => {
		expect(priceCacheKey("Crysis 2 Remastered")).not.toBe(
			priceCacheKey("Crysis 2"),
		);
	});

	it("matches the same game written differently by two suppliers", () => {
		expect(priceCacheKey("Crysis™ 2: Remastered")).toBe(
			priceCacheKey("crysis 2 remastered"),
		);
	});

	it("ignores quantity, because the price is per unit", () => {
		expect(priceCacheKey("Hades x2")).toBe(priceCacheKey("Hades"));
	});

	it("does not depend on the order the edition words appear in", () => {
		expect(priceCacheKey("Game GOTY Deluxe")).toBe(
			priceCacheKey("Game Deluxe GOTY"),
		);
	});
});

describe("CachedPriceFetcher", () => {
	it("serves a hit from the cache without touching the catalog, and logs it", async () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const cache = fakeCache({ [priceCacheKey("Hades")]: priced() });
		const source = fakeSource({});

		const result = await build(source, cache).fetch([game("Hades")]);

		expect(source.lookup).not.toHaveBeenCalled();
		expect(result).toEqual([
			{
				id: 1,
				name: "Hades",
				foundName: "Hades",
				popularity: 500,
				region: "",
				id_steam: "1145360",
				gamivo_id: "123",
				hasGamivoOffer: true,
				GamivoPrice: 4.99,
			},
		]);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("💾 [CACHE] hit: Hades → €4.99"),
		);
		log.mockRestore();
	});

	it("sends only the misses to the catalog and stores what it found", async () => {
		const cache = fakeCache({ [priceCacheKey("Hades")]: priced() });
		const source = fakeSource({
			Celeste: priced({ bestPrice: 2, foundName: "Celeste" }),
		});

		const result = await build(source, cache).fetch([
			game("Hades"),
			game("Celeste", 2),
		]);

		expect(source.lookup).toHaveBeenCalledWith(["Celeste"]);
		expect(cache.store.get(priceCacheKey("Celeste"))).toEqual(
			priced({ bestPrice: 2, foundName: "Celeste" }),
		);
		expect(result.map((g) => [g.name, g.GamivoPrice])).toEqual([
			["Hades", 4.99],
			["Celeste", 2],
		]);
	});

	it("stores a definitive not-found, and a later search skips the catalog for it", async () => {
		const cache = fakeCache();
		const source = fakeSource({ Obscure: { status: "not-found" } });
		const fetcher = build(source, cache);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		expect(await fetcher.fetch([game("Obscure")])).toEqual([]);
		expect(await fetcher.fetch([game("Obscure")])).toEqual([]);

		expect(source.lookup).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith(
			expect.stringContaining("hit: Obscure → not found"),
		);
		log.mockRestore();
	});

	it("never stores a transient failure, so the next search tries again", async () => {
		const cache = fakeCache();
		const source = fakeSource({ Flaky: { status: "failed" } });
		const fetcher = build(source, cache);

		expect(await fetcher.fetch([game("Flaky")])).toEqual([]);
		await fetcher.fetch([game("Flaky")]);

		expect(cache.store.size).toBe(0);
		expect(source.lookup).toHaveBeenCalledTimes(2);
	});

	it("stores a Gamivo offer even when its id could not be resolved", async () => {
		// Sem `API_KEY_GAMIVO` o id nunca sai, e "não há slug" é indistinguível de
		// falha. Recusar esse caso deixaria fora do cache os jogos com oferta na
		// Gamivo — o caso mais comum (ADR 0008).
		const cache = fakeCache();
		const source = fakeSource({ Hades: priced({ gamivo_id: undefined }) });

		const result = await build(source, cache).fetch([game("Hades")]);

		expect(result).toHaveLength(1);
		expect(cache.store.size).toBe(1);
	});

	it("sends names that share a cache key to the catalog only once", async () => {
		// "Crysis™ 2" e "crysis 2" são o mesmo jogo para o cache: uma busca só,
		// e o resultado vale para os dois.
		const cache = fakeCache();
		const source = fakeSource({ "Crysis™ 2": priced({ bestPrice: 7 }) });

		const result = await build(source, cache).fetch([
			game("Crysis™ 2"),
			game("crysis 2", 2),
		]);

		expect(source.lookup).toHaveBeenCalledWith(["Crysis™ 2"]);
		expect(result.map((g) => [g.id, g.GamivoPrice])).toEqual([
			[1, 7],
			[2, 7],
		]);
	});

	it("stores a price without a Gamivo offer — the Gamivo cut is the preset's", async () => {
		const cache = fakeCache();
		const source = fakeSource({
			Hades: priced({ hasGamivoOffer: false, gamivo_id: undefined }),
		});

		const result = await build(source, cache).fetch([game("Hades")]);

		expect(result[0].hasGamivoOffer).toBe(false);
		expect(cache.store.size).toBe(1);
	});

	it("turns the region in the name into the display region and strips it from the name", async () => {
		const cache = fakeCache();
		const source = fakeSource({ "Hades EU": priced() });

		const [result] = await build(source, cache).fetch([game("Hades EU")]);

		expect(result.region).toBe("EU");
		expect(result.name.trim()).toBe("Hades");
	});

	it("keeps the order of the input", async () => {
		const cache = fakeCache({ [priceCacheKey("B")]: priced({ bestPrice: 2 }) });
		const source = fakeSource({
			A: priced({ bestPrice: 1 }),
			C: priced({ bestPrice: 3 }),
		});

		const result = await build(source, cache).fetch([
			game("A"),
			game("B"),
			game("C"),
		]);

		expect(result.map((g) => g.name)).toEqual(["A", "B", "C"]);
	});

	it("does not call the cache or the catalog for an empty list", async () => {
		const cache = fakeCache();
		const source = fakeSource({});

		expect(await build(source, cache).fetch([])).toEqual([]);
		expect(cache.get).not.toHaveBeenCalled();
		expect(source.lookup).not.toHaveBeenCalled();
	});

	it("propagates a fatal catalog error, like a dead browser", async () => {
		const cache = fakeCache();
		const source = {
			lookup: vi.fn().mockRejectedValue(new Error("browser died")),
		};

		await expect(
			new CachedPriceFetcher(
				source as unknown as CatalogPriceSource,
				cache as unknown as PriceCache,
			).fetch([game("Hades")]),
		).rejects.toThrow("browser died");
	});
});
