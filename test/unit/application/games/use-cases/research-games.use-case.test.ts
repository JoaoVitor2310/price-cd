import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import type { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import {
	type ResearchDelivery,
	ResearchGamesUseCase,
} from "@/application/games/use-cases/research-games.use-case.js";
import { flatPopularity } from "@/domain/games/search-criteria.js";

const game = (name: string, GamivoPrice?: number): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	region: "global",
	GamivoPrice,
});

/** As dependências agora vão para o construtor; a entrada é só dado. */
const makeUseCase = (
	found: FoundGames[],
	priced: FoundGames[],
	tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) },
) =>
	new ResearchGamesUseCase(
		new PriceGames(
			{ fetch: vi.fn().mockResolvedValue(found) } as PopularityFetcher,
			{ fetch: vi.fn().mockResolvedValue(priced) } as PriceFetcher,
		),
		tradeImporter,
	);

const makeInput = (
	found: FoundGames[],
	delivery: ResearchDelivery = "trade",
	minPrice = 0.5,
) => ({
	gameNames: found.map((g) => g.name),
	criteria: { popularity: flatPopularity(100), minPrice, checkGamivoOffer: false },
	delivery,
});

describe("ResearchGamesUseCase", () => {
	it("does not import games priced at or below the minimum price", async () => {
		const tradeImporter: GameTradeImporter = {
			import: vi.fn().mockResolvedValue(undefined),
		};
		const found = [game("Cheap"), game("Threshold"), game("Worthy")];
		const priced = [
			game("Cheap", 0.49),
			game("Threshold", 0.5),
			game("Worthy", 2),
		];

		await makeUseCase(found, priced, tradeImporter).execute(makeInput(found));

		expect(tradeImporter.import).toHaveBeenCalledTimes(1);
		const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
		expect(imported.map((g) => g.name)).toEqual(["Worthy"]);
	});

	it("sends the market price to the Sistema Estoque as market_price_euro", async () => {
		const tradeImporter: GameTradeImporter = {
			import: vi.fn().mockResolvedValue(undefined),
		};
		const found = [game("Worthy")];
		const priced = [game("Worthy", 2)];

		await makeUseCase(found, priced, tradeImporter).execute(makeInput(found));

		const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
		expect(imported[0]).toMatchObject({ name: "Worthy", market_price_euro: 2 });
		expect(imported[0]).not.toHaveProperty("price_euro");
	});

	it("skips the import entirely when every price is too low", async () => {
		const tradeImporter: GameTradeImporter = {
			import: vi.fn().mockResolvedValue(undefined),
		};
		const found = [game("Cheap")];
		const priced = [game("Cheap", 0.1)];

		const result = await makeUseCase(found, priced, tradeImporter).execute(
			makeInput(found),
		);

		expect(tradeImporter.import).not.toHaveBeenCalled();
		expect(result).toBeNull();
	});

	it("keeps games below the default floor when minPrice is lowered (bundle flow)", async () => {
		const tradeImporter: GameTradeImporter = {
			import: vi.fn().mockResolvedValue(undefined),
		};
		const found = [game("Cheap"), game("Free")];
		const priced = [game("Cheap", 0.1), game("Free", 0)];

		await makeUseCase(found, priced, tradeImporter).execute(
			makeInput(found, "trade", 0),
		);

		expect(tradeImporter.import).toHaveBeenCalledTimes(1);
		const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
		// minPrice 0, corte estrito: 0.10 entra; 0.00 (sem valor negociável) fica de fora.
		expect(imported.map((g) => g.name)).toEqual(["Cheap"]);
	});

	it("filters cheap games in demo mode too", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.5)];

		const result = await makeUseCase(found, priced).execute(
			makeInput(found, "demo"),
		);

		expect(result?.map((g) => g.name)).toEqual(["Worthy"]);
	});

	describe("delivery", () => {
		const many = Array.from({ length: 12 }, (_, i) => game(`Game ${i}`));
		const manyPriced = many.map((g) => ({ ...g, GamivoPrice: 2 }));

		it("respond: returns every game and creates no Trade (the bundle sync case)", async () => {
			const tradeImporter: GameTradeImporter = { import: vi.fn() };

			const result = await makeUseCase(many, manyPriced, tradeImporter).execute(
				makeInput(many, "respond"),
			);

			expect(result).toHaveLength(12);
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});

		it("demo: caps the list at 10 games and creates no Trade", async () => {
			const tradeImporter: GameTradeImporter = { import: vi.fn() };
			const popularity = { fetch: vi.fn().mockResolvedValue(many) } as PopularityFetcher;
			const useCase = new ResearchGamesUseCase(
				new PriceGames(popularity, { fetch: vi.fn().mockResolvedValue([]) } as PriceFetcher),
				tradeImporter,
			);

			await useCase.execute(makeInput(many, "demo"));

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toHaveLength(10);
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});

		it("trade: creates the Trade and returns nothing", async () => {
			const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

			const result = await makeUseCase(many, manyPriced, tradeImporter).execute(
				makeInput(many, "trade"),
			);

			expect(result).toBeNull();
			expect(vi.mocked(tradeImporter.import).mock.calls[0][0]).toHaveLength(12);
		});
	});
});
