import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import type { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { ResearchGamesUseCase } from "@/application/games/research-games.use-case.js";

const game = (name: string, GamivoPrice?: number): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	region: "global",
	GamivoPrice,
});

const makeInput = (
	found: FoundGames[],
	priced: FoundGames[],
	tradeImporter?: GameTradeImporter,
) => ({
	gameNames: found.map((g) => g.name),
	minPopularity: 100,
	checkGamivoOffer: false,
	popularityFetcher: {
		fetch: vi.fn().mockResolvedValue(found),
	} as PopularityFetcher,
	priceFetcher: { fetch: vi.fn().mockResolvedValue(priced) } as PriceFetcher,
	tradeImporter,
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

		await new ResearchGamesUseCase().execute(
			makeInput(found, priced, tradeImporter),
		);

		expect(tradeImporter.import).toHaveBeenCalledTimes(1);
		const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
		expect(imported.map((g) => g.name)).toEqual(["Worthy"]);
	});

	it("skips the import entirely when every price is too low", async () => {
		const tradeImporter: GameTradeImporter = {
			import: vi.fn().mockResolvedValue(undefined),
		};
		const found = [game("Cheap")];
		const priced = [game("Cheap", 0.1)];

		const result = await new ResearchGamesUseCase().execute(
			makeInput(found, priced, tradeImporter),
		);

		expect(tradeImporter.import).not.toHaveBeenCalled();
		expect(result).toBeNull();
	});

	it("filters cheap games in demo mode too", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.5)];

		const result = await new ResearchGamesUseCase().execute(
			makeInput(found, priced),
		);

		expect(result?.map((g) => g.name)).toEqual(["Worthy"]);
	});
});
