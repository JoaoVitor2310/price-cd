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
	lookupPopularity: true,
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

	describe("Gamivo offer", () => {
		// O fetcher devolve o preço bruto (pode vir do cache de outro preset); o
		// corte de Gamivo do preset é aplicado pelo motor. Ver ADR 0008.
		const withGamivo = (name: string, hasGamivoOffer: boolean) => ({
			...game(name, 2),
			hasGamivoOffer,
		});

		it("does not pass the Gamivo criterion to the price fetcher", async () => {
			const { engine, priceFetcher } = makeEngine([game("Hades")], [game("Hades", 2)]);

			await engine.run({ gameNames: ["Hades"], criteria: criteria({ checkGamivoOffer: true }) });

			expect(priceFetcher.fetch).toHaveBeenCalledWith(expect.any(Array));
			expect(priceFetcher.fetch.mock.calls[0]).toHaveLength(1);
		});

		it("drops games without a Gamivo offer when the criteria require one, and logs it", async () => {
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			const { engine } = makeEngine(
				[game("On Gamivo"), game("Off Gamivo")],
				[withGamivo("On Gamivo", true), withGamivo("Off Gamivo", false)],
			);

			const { priced } = await engine.run({
				gameNames: ["On Gamivo", "Off Gamivo"],
				criteria: criteria({ checkGamivoOffer: true }),
			});

			expect(priced.map((g) => g.name)).toEqual(["On Gamivo"]);
			expect(log).toHaveBeenCalledWith(expect.stringContaining('Discarded "Off Gamivo" — no Gamivo offer'));
			log.mockRestore();
		});

		it("keeps them when the criteria do not require a Gamivo offer", async () => {
			const { engine } = makeEngine(
				[game("Off Gamivo")],
				[withGamivo("Off Gamivo", false)],
			);

			const { priced } = await engine.run(input(["Off Gamivo"]));

			expect(priced.map((g) => g.name)).toEqual(["Off Gamivo"]);
		});
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

		it("asks the fetcher for a lookup exactly when criteria.lookupPopularity says so", async () => {
			// Os tiers só cortam; quem decide consultar é a flag.
			const { engine, popularityFetcher } = makeEngine(
				[game("Any", undefined, 0)],
				[game("Any", 2, 0)],
			);

			await engine.run({
				gameNames: ["Any"],
				criteria: criteria({
					popularity: tiers(0, 0),
					lookupPopularity: false,
				}),
			});
			await engine.run({
				gameNames: ["Any"],
				criteria: criteria({ popularity: tiers(0, 0), lookupPopularity: true }),
			});

			expect(popularityFetcher.fetch).toHaveBeenNthCalledWith(
				1,
				["Any"],
				false,
			);
			expect(popularityFetcher.fetch).toHaveBeenNthCalledWith(2, ["Any"], true);
		});

		it("looks the popularity up with 0/0 when the flag asks for it, and returns the real number", async () => {
			const { engine } = makeEngine(
				[game("Known", undefined, 842)],
				[game("Known", 2, 842)],
			);

			const { priced } = await engine.run({
				gameNames: ["Known"],
				criteria: criteria({ popularity: tiers(0, 0) }),
			});

			expect(priced[0].popularity).toBe(842);
		});
	});

	describe("games SteamCharts does not know", () => {
		const log = () => vi.spyOn(console, "log").mockImplementation(() => {});

		it("keeps them, with popularity 0, when no tier cuts by popularity (a bundle)", async () => {
			const spy = log();
			// O SteamCharts só devolve "Known"; "Obscure" some do `found`.
			const { engine, priceFetcher } = makeEngine(
				[game("Known", undefined, 40)],
				[game("Known", 2, 40), { ...game("Obscure", 3, 0), id: 1 }],
			);

			const { priced, found } = await engine.run({
				gameNames: ["Known", "Obscure"],
				criteria: criteria({ popularity: tiers(0, 0), minPrice: 0 }),
			});

			const sentToPricing = priceFetcher.fetch.mock.calls[0][0] as FoundGames[];
			expect(sentToPricing.map((g) => [g.name, g.popularity])).toEqual([
				["Known", 40],
				["Obscure", 0],
			]);
			expect(priced.map((g) => g.name)).toEqual(["Known", "Obscure"]);
			// `found` continua sendo o que o SteamCharts achou, sem os sintéticos.
			expect(found.map((g) => g.name)).toEqual(["Known"]);
			spy.mockRestore();
		});

		it("drops them once a tier asks for any popularity", async () => {
			const spy = log();
			const { engine, priceFetcher } = makeEngine(
				[game("Known", undefined, 40)],
				[game("Known", 2, 40)],
			);

			await engine.run({
				gameNames: ["Known", "Obscure"],
				criteria: criteria({ popularity: tiers(1, 1) }),
			});

			const sentToPricing = priceFetcher.fetch.mock.calls[0][0] as FoundGames[];
			expect(sentToPricing.map((g) => g.name)).toEqual(["Known"]);
			spy.mockRestore();
		});

		it("lets the tier of their price decide after pricing: 0 up to the threshold, 100 above", async () => {
			const spy = log();
			const { engine } = makeEngine(
				[],
				[game("Cheap unknown", 3, 0), game("Pricey unknown", 12, 0)],
			);

			const { priced } = await engine.run({
				gameNames: ["Cheap unknown", "Pricey unknown"],
				criteria: criteria({ popularity: tiers(0, 100), minPrice: 0 }),
			});

			expect(priced.map((g) => g.name)).toEqual(["Cheap unknown"]);
			spy.mockRestore();
		});

		it("says in the log that a game was kept without popularity data", async () => {
			const spy = log();
			const { engine } = makeEngine([], [game("Obscure", 3, 0)]);

			await engine.run({
				gameNames: ["Obscure"],
				criteria: criteria({ popularity: tiers(0, 0), minPrice: 0 }),
			});

			expect(spy).toHaveBeenCalledWith(
				expect.stringContaining(
					'"Obscure" has no SteamCharts data — kept with popularity 0',
				),
			);
			spy.mockRestore();
		});

		it("does not log that when nobody was unrated", async () => {
			const spy = log();
			const { engine } = makeEngine(
				[game("Known", undefined, 40)],
				[game("Known", 2, 40)],
			);

			await engine.run({
				gameNames: ["Known"],
				criteria: criteria({ popularity: tiers(0, 0), minPrice: 0 }),
			});

			expect(spy).not.toHaveBeenCalledWith(
				expect.stringContaining("has no SteamCharts data"),
			);
			spy.mockRestore();
		});
	});
});
