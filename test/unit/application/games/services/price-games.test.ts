import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { PriceGames } from "@/application/games/services/price-games.js";

const game = (name: string, GamivoPrice?: number): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	region: "global",
	GamivoPrice,
});

const makeEngine = (found: FoundGames[], priced: FoundGames[]) => {
	const popularityFetcher = { fetch: vi.fn().mockResolvedValue(found) };
	const priceFetcher = { fetch: vi.fn().mockResolvedValue(priced) };
	return {
		engine: new PriceGames(
			popularityFetcher as PopularityFetcher,
			priceFetcher as PriceFetcher,
		),
		popularityFetcher,
		priceFetcher,
	};
};

const input = (gameNames: string[], minPrice?: number) => ({
	gameNames,
	minPopularity: 100,
	checkGamivoOffer: false,
	minPrice,
});

describe("PriceGames", () => {
	it("exposes each stage so callers can shape their own output", async () => {
		// É a razão de a extração existir: `/api/games/search` monta um resumo com
		// estas contagens, enquanto `lists` e `suppliers` leem só `priced`.
		const { engine } = makeEngine(
			[game("Cheap"), game("Worthy")],
			[game("Cheap", 0.2), game("Worthy", 1.99)],
		);

		const result = await engine.run(input(["Cheap", "Worthy"]));

		expect(result.requested).toEqual(["Cheap", "Worthy"]);
		expect(result.found).toHaveLength(2);
		expect(result.worthyByPopularity).toHaveLength(2);
		expect(result.priced.map((g) => g.name)).toEqual(["Worthy"]);
	});

	it("deduplicates the requested names", async () => {
		const { engine, popularityFetcher } = makeEngine([game("Hades")], [game("Hades", 2)]);

		const result = await engine.run(input(["Hades", "Hades"]));

		expect(result.requested).toEqual(["Hades"]);
		expect(popularityFetcher.fetch).toHaveBeenCalledWith(["Hades"], 100);
	});

	it("honours a lowered price floor", async () => {
		// Fluxo de bundle: minPrice 0 aceita jogos abaixo do piso padrão.
		const { engine } = makeEngine([game("Cheap")], [game("Cheap", 0.1)]);

		expect((await engine.run(input(["Cheap"], 0))).priced).toHaveLength(1);
		expect((await engine.run(input(["Cheap"]))).priced).toHaveLength(0);
	});

	it("does not open the price scraper when nothing survives the popularity filter", async () => {
		// Abrir o browser do AllKeyShop para lista vazia é custo puro — e, neste
		// projeto, custo de Chromium.
		const { engine, priceFetcher } = makeEngine([], []);

		const result = await engine.run(input(["Unknown"]));

		expect(priceFetcher.fetch).not.toHaveBeenCalled();
		expect(result.priced).toEqual([]);
	});

	it("does not fetch anything for an empty request", async () => {
		const { engine, popularityFetcher, priceFetcher } = makeEngine([], []);

		const result = await engine.run(input([]));

		expect(popularityFetcher.fetch).not.toHaveBeenCalled();
		expect(priceFetcher.fetch).not.toHaveBeenCalled();
		expect(result).toEqual({
			requested: [],
			found: [],
			worthyByPopularity: [],
			priced: [],
		});
	});

	it("forwards checkGamivoOffer to the price fetcher", async () => {
		const { engine, priceFetcher } = makeEngine([game("Hades")], [game("Hades", 2)]);

		await engine.run({ ...input(["Hades"]), checkGamivoOffer: true });

		expect(priceFetcher.fetch).toHaveBeenCalledWith(expect.any(Array), true);
	});
});
