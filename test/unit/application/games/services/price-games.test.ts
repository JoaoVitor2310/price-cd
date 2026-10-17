import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import {
	flatPopularity,
	type PopularityTiers,
	type SearchCriteria,
} from "@/domain/games/search-criteria.js";

const game = (name: string, GamivoPrice?: number, popularity = 500): FoundGames => ({
	id: 0,
	name,
	popularity,
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

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
	popularity: flatPopularity(100),
	minPrice: 0.5,
	checkGamivoOffer: false,
	...overrides,
});

const input = (gameNames: string[], minPrice = 0.5) => ({
	gameNames,
	criteria: criteria({ minPrice }),
});

const tiers = (upToThreshold: number, aboveThreshold: number): PopularityTiers => ({
	upToThreshold,
	aboveThreshold,
	priceThresholdEuro: 5,
});

describe("PriceGames", () => {
	it("exposes each stage so callers can shape their own output", async () => {
		// Hoje todo consumidor lê só `priced`; os estágios intermediários existem
		// para teste e diagnóstico, e este teste trava que continuam expostos.
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
		expect(popularityFetcher.fetch).toHaveBeenCalledWith(["Hades"], true);
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

		await engine.run({ gameNames: ["Hades"], criteria: criteria({ checkGamivoOffer: true }) });

		expect(priceFetcher.fetch).toHaveBeenCalledWith(expect.any(Array), true);
	});

	describe("popularity tiers", () => {
		it("cuts by the LOWEST tier before pricing, so the AllKeyShop never sees hopeless games", async () => {
			const { engine, popularityFetcher, priceFetcher } = makeEngine(
				[game("Obscure", undefined, 9), game("Niche", undefined, 10), game("Hit", undefined, 1000)],
				[],
			);

			await engine.run({ gameNames: ["Obscure", "Niche", "Hit"], criteria: criteria({ popularity: tiers(10, 100) }) });

			expect(popularityFetcher.fetch).toHaveBeenCalledWith(expect.any(Array), true);
			const sentToPricing = priceFetcher.fetch.mock.calls[0][0].map((g: FoundGames) => g.name);
			expect(sentToPricing).toEqual(["Niche", "Hit"]);
		});

		it("applies the exact tier after pricing: cheap games need little popularity, expensive ones a lot", async () => {
			const { engine } = makeEngine(
				[game("Cheap niche", undefined, 40), game("Pricey niche", undefined, 40), game("Pricey hit", undefined, 150)],
				[game("Cheap niche", 3, 40), game("Pricey niche", 12, 40), game("Pricey hit", 12, 150)],
			);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});

			const { priced } = await engine.run({
				gameNames: ["Cheap niche", "Pricey niche", "Pricey hit"],
				criteria: criteria({ popularity: tiers(10, 100) }),
			});

			expect(priced.map((g) => g.name)).toEqual(["Cheap niche", "Pricey hit"]);
			// O descarte depois do preço precisa aparecer no log, senão o jogo some
			// depois de um "Price found".
			expect(log).toHaveBeenCalledWith(expect.stringContaining('Discarded "Pricey niche" — popularity 40 is below 100'));
			log.mockRestore();
		});

		it("treats a price exactly at the threshold as the lower tier", async () => {
			const { engine } = makeEngine([game("Edge", undefined, 10)], [game("Edge", 5, 10)]);

			const { priced } = await engine.run({ gameNames: ["Edge"], criteria: criteria({ popularity: tiers(10, 100) }) });

			expect(priced).toHaveLength(1);
		});

		it("skips the SteamCharts lookup only when BOTH tiers are 0", async () => {
			const { engine, popularityFetcher } = makeEngine([game("Any", undefined, 0)], [game("Any", 2, 0)]);

			const { priced } = await engine.run({ gameNames: ["Any"], criteria: criteria({ popularity: tiers(0, 0) }) });

			expect(popularityFetcher.fetch).toHaveBeenCalledWith(["Any"], false);
			expect(priced).toHaveLength(1);
		});

		it("still looks the popularity up when only one tier is 0", async () => {
			// O menor tier é 0, mas o de cima (100) precisa de popularidade real.
			const { engine, popularityFetcher } = makeEngine([game("Any", undefined, 500)], []);

			await engine.run({ gameNames: ["Any"], criteria: criteria({ popularity: tiers(0, 100) }) });

			expect(popularityFetcher.fetch).toHaveBeenCalledWith(["Any"], true);
		});
	});
});
