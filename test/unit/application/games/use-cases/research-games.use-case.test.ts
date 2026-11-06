import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
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

const makeUseCase = (found: FoundGames[], priced: FoundGames[]) =>
	new ResearchGamesUseCase(
		new PriceGames(
			{ fetch: vi.fn().mockResolvedValue(found) } as PopularityFetcher,
			{
				fetch: vi.fn().mockResolvedValue({ games: priced, failed: [] }),
			} as PriceFetcher,
		),
	);

const makeInput = (found: FoundGames[], delivery: ResearchDelivery) => ({
	gameNames: found.map((g) => g.name),
	criteria: {
		popularity: flatPopularity(100),
		minPrice: 0.5,
		checkGamivoOffer: false,
	},
	delivery,
});

describe("ResearchGamesUseCase", () => {
	it("filters cheap games in demo mode too", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.5)];

		const result = await makeUseCase(found, priced).execute(
			makeInput(found, "demo"),
		);

		expect(result.map((g) => g.name)).toEqual(["Worthy"]);
	});

	describe("delivery", () => {
		const many = Array.from({ length: 12 }, (_, i) => game(`Game ${i}`));
		const manyPriced = many.map((g) => ({ ...g, GamivoPrice: 2 }));

		it("respond: returns every game (the bundle sync case)", async () => {
			const result = await makeUseCase(many, manyPriced).execute(
				makeInput(many, "respond"),
			);

			expect(result).toHaveLength(12);
		});

		it("demo: caps the list at 10 games", async () => {
			const popularity = {
				fetch: vi.fn().mockResolvedValue(many),
			} as PopularityFetcher;
			const useCase = new ResearchGamesUseCase(
				new PriceGames(popularity, {
					fetch: vi.fn().mockResolvedValue({ games: [], failed: [] }),
				} as PriceFetcher),
			);

			await useCase.execute(makeInput(many, "demo"));

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toHaveLength(10);
		});
	});
});
