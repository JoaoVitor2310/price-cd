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

/** As dependências agora vão para o construtor; a entrada é só dado. */
const makeUseCase = (
	found: FoundGames[],
	priced: FoundGames[],
	tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) },
) =>
	new ResearchGamesUseCase(
		{ fetch: vi.fn().mockResolvedValue(found) } as PopularityFetcher,
		{ fetch: vi.fn().mockResolvedValue(priced) } as PriceFetcher,
		tradeImporter,
	);

const makeInput = (found: FoundGames[], demo = false) => ({
	gameNames: found.map((g) => g.name),
	minPopularity: 100,
	checkGamivoOffer: false,
	demo,
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

		await makeUseCase(found, priced, tradeImporter).execute({
			...makeInput(found),
			minPrice: 0,
		});

		expect(tradeImporter.import).toHaveBeenCalledTimes(1);
		const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
		// minPrice 0, corte estrito: 0.10 entra; 0.00 (sem valor negociável) fica de fora.
		expect(imported.map((g) => g.name)).toEqual(["Cheap"]);
	});

	it("filters cheap games in demo mode too", async () => {
		const found = [game("Cheap"), game("Worthy")];
		const priced = [game("Cheap", 0.2), game("Worthy", 1.5)];

		const result = await makeUseCase(found, priced).execute(
			makeInput(found, true),
		);

		expect(result?.map((g) => g.name)).toEqual(["Worthy"]);
	});
});
