import { describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import type {
	GameTradeImporter,
	GameTradeInput,
} from "@/application/games/ports/game-trade-importer.port.js";
import {
	StockUnavailableError,
	type TradeWithOfferCreator,
} from "@/application/games/ports/trade-with-offer-creator.port.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import {
	CreateResearchTrade,
	PriceResearchIncompleteError,
	ResearchCancelledError,
} from "@/application/games/services/create-research-trade.js";
import { flatPopularity } from "@/domain/games/search-criteria.js";

const game = (name: string, GamivoPrice?: number): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	region: "global",
	GamivoPrice,
});

function makeCreator(
	create: TradeWithOfferCreator["create"] = vi.fn().mockResolvedValue({
		status: "created",
		tradeUuid: "3a9e0000-0000-4000-8000-000000000000",
	}),
) {
	return { create: vi.fn(create) } satisfies TradeWithOfferCreator;
}

const makeImporter = (): GameTradeImporter => ({
	import: vi.fn().mockResolvedValue(undefined),
});

const makeUseCase = (
	found: FoundGames[],
	priced: FoundGames[],
	tradeImporter: GameTradeImporter = makeImporter(),
	withOffer: TradeWithOfferCreator = makeCreator(),
	failed: string[] = [],
) =>
	new CreateResearchTrade(
		new PriceGames(
			{ fetch: vi.fn().mockResolvedValue(found) } as PopularityFetcher,
			{
				fetch: vi.fn().mockResolvedValue({ games: priced, failed }),
			} as PriceFetcher,
		),
		tradeImporter,
		withOffer,
	);

const makeRequest = (found: FoundGames[], minPrice = 0.5) => ({
	gameNames: found.map((g) => g.name),
	criteria: {
		popularity: flatPopularity(100),
		minPrice,
		checkGamivoOffer: false,
	},
});

describe("CreateResearchTrade", () => {
	describe("Trade without an offer", () => {
		it("does not import games priced at or below the minimum price", async () => {
			const tradeImporter = makeImporter();
			const found = [game("Cheap"), game("Threshold"), game("Worthy")];
			const priced = [
				game("Cheap", 0.49),
				game("Threshold", 0.5),
				game("Worthy", 2),
			];

			await makeUseCase(found, priced, tradeImporter).run(
				makeRequest(found),
			);

			expect(tradeImporter.import).toHaveBeenCalledTimes(1);
			const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
			expect(imported.map((g) => g.name)).toEqual(["Worthy"]);
		});

		it("sends the market price to the Sistema Estoque as market_price_euro", async () => {
			const tradeImporter = makeImporter();
			const found = [game("Worthy")];

			await makeUseCase(found, [game("Worthy", 2)], tradeImporter).run(
				makeRequest(found),
			);

			const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
			expect(imported[0]).toMatchObject({
				name: "Worthy",
				market_price_euro: 2,
			});
			expect(imported[0]).not.toHaveProperty("price_euro");
		});

		it("skips the import entirely when every price is too low", async () => {
			const tradeImporter = makeImporter();
			const found = [game("Cheap")];

			const outcome = await makeUseCase(
				found,
				[game("Cheap", 0.1)],
				tradeImporter,
			).run(makeRequest(found));

			expect(tradeImporter.import).not.toHaveBeenCalled();
			expect(outcome).toEqual({
				status: "not_created",
				reason: "nothing_priced",
			});
		});

		it("keeps games below the default floor when minPrice is lowered (bundle flow)", async () => {
			const tradeImporter = makeImporter();
			const found = [game("Cheap"), game("Free")];
			const priced = [game("Cheap", 0.1), game("Free", 0)];

			await makeUseCase(found, priced, tradeImporter).run(
				makeRequest(found, 0),
			);

			expect(tradeImporter.import).toHaveBeenCalledTimes(1);
			const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
			// minPrice 0, corte estrito: 0.10 entra; 0.00 (sem valor negociável) fica de fora.
			expect(imported.map((g) => g.name)).toEqual(["Cheap"]);
		});
	});

	describe("when the catalog could not answer", () => {
		const found = [game("Worthy"), game("Flaky")];

		it("creates the Trade with what was priced when only part of it failed", async () => {
			const tradeImporter = makeImporter();

			const outcome = await makeUseCase(
				found,
				[game("Worthy", 2)],
				tradeImporter,
				undefined,
				["Flaky"],
			).run(makeRequest(found));

			expect(outcome).toEqual({ status: "created" });
			const [imported] = vi.mocked(tradeImporter.import).mock.calls[0];
			expect(imported.map((g) => g.name)).toEqual(["Worthy"]);
		});

		it("fails instead of reporting nothing priced when every lookup failed", async () => {
			const tradeImporter = makeImporter();

			await expect(
				makeUseCase(found, [], tradeImporter, undefined, [
					"Worthy",
					"Flaky",
				]).run(makeRequest(found)),
			).rejects.toBeInstanceOf(PriceResearchIncompleteError);
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});

		it("fails when nothing passed and at least one game was never answered", async () => {
			await expect(
				makeUseCase(found, [game("Worthy", 0.1)], undefined, undefined, [
					"Flaky",
				]).run(makeRequest(found)),
			).rejects.toBeInstanceOf(PriceResearchIncompleteError);
		});
	});

	describe("when the shutdown cancels the research", () => {
		const found = [game("Worthy")];

		it("does not call the Sistema Estoque, even with games priced", async () => {
			const tradeImporter = makeImporter();
			const creator = makeCreator();

			await expect(
				makeUseCase(found, [game("Worthy", 2)], tradeImporter, creator).run(
					makeRequest(found),
					{ aborted: true },
				),
			).rejects.toBeInstanceOf(ResearchCancelledError);
			expect(tradeImporter.import).not.toHaveBeenCalled();
			expect(creator.create).not.toHaveBeenCalled();
		});

		it("does not report nothing priced from an interrupted research", async () => {
			await expect(
				makeUseCase(found, []).run(makeRequest(found), { aborted: true }),
			).rejects.toBeInstanceOf(ResearchCancelledError);
		});

		it("goes on when the signal was not aborted", async () => {
			await expect(
				makeUseCase(found, [game("Worthy", 2)]).run(makeRequest(found), {
					aborted: false,
				}),
			).resolves.toEqual({ status: "created" });
		});
	});

	describe("choosing how the Trade is born", () => {
		const found = [game("Worthy"), game("Rust ROW")];
		const priced = [
			game("Worthy", 2),
			{ ...game("Rust ROW", 3), region: "ROW" },
		];
		const request = {
			...makeRequest(found),
			supplierSteamId: "76561198012345678",
			listCode: "AbC12",
		};

		it("creates the Trade with an offer when the request carries a currency, and reports its uuid", async () => {
			const tradeImporter: GameTradeImporter = { import: vi.fn() };
			const creator = makeCreator();

			const outcome = await makeUseCase(
				found,
				priced,
				tradeImporter,
				creator,
			).run({ ...request, currency: "eur" });

			expect(outcome).toEqual({
				status: "created",
				tradeUuid: "3a9e0000-0000-4000-8000-000000000000",
			});
			expect(tradeImporter.import).not.toHaveBeenCalled();
			const [games, options] = creator.create.mock.calls[0];
			expect(games.map((g) => [g.name, g.region])).toEqual([
				["Worthy", "global"],
				["Rust ROW", "ROW"],
			]);
			expect(options).toEqual({
				supplierSteamId: "76561198012345678",
				currency: "eur",
				listCode: "AbC12",
				title: undefined,
			});
		});

		it("hands the request uuid to the Sistema Estoque, its idempotency key", async () => {
			const creator = makeCreator();

			await makeUseCase(found, priced, { import: vi.fn() }, creator).run({
				...request,
				currency: "eur",
				requestUuid: "8c1f0000-0000-4000-8000-000000000000",
			});

			expect(creator.create.mock.calls[0][1]).toMatchObject({
				requestUuid: "8c1f0000-0000-4000-8000-000000000000",
			});
		});

		it("keeps the Trade without an offer when there is no currency", async () => {
			const tradeImporter = makeImporter();
			const creator = makeCreator();

			const outcome = await makeUseCase(
				found,
				priced,
				tradeImporter,
				creator,
			).run(request);

			expect(outcome).toEqual({ status: "created" });
			expect(tradeImporter.import).toHaveBeenCalledTimes(1);
			expect(creator.create).not.toHaveBeenCalled();
		});

		it("reports nothing priced without calling the Sistema Estoque", async () => {
			const creator = makeCreator();

			const outcome = await makeUseCase(
				found,
				[game("Worthy", 0.1)],
				undefined,
				creator,
			).run({ ...request, currency: "tf2" });

			expect(outcome).toEqual({
				status: "not_created",
				reason: "nothing_priced",
			});
			expect(creator.create).not.toHaveBeenCalled();
		});

		it("reports nothing to offer when the Sistema Estoque declines", async () => {
			const creator = makeCreator(
				vi.fn().mockResolvedValue({ status: "not_created" }),
			);

			const outcome = await makeUseCase(
				found,
				priced,
				undefined,
				creator,
			).run({ ...request, currency: "usd" });

			expect(outcome).toEqual({
				status: "not_created",
				reason: "nothing_to_offer",
			});
		});

		it("lets the Sistema Estoque failure through with its type", async () => {
			const creator = makeCreator(
				vi
					.fn()
					.mockRejectedValue(
						new StockUnavailableError("Sistema Estoque answered HTTP 503"),
					),
			);

			await expect(
				makeUseCase(found, priced, undefined, creator).run({
					...request,
					currency: "eur",
				}),
			).rejects.toBeInstanceOf(StockUnavailableError);
		});

		it("refuses a Trade with an offer without the supplier Steam ID", async () => {
			const creator = makeCreator();

			await expect(
				makeUseCase(found, priced, undefined, creator).run({
					...request,
					supplierSteamId: undefined,
					currency: "eur",
				}),
			).rejects.toThrow("requires the supplier Steam ID");
			expect(creator.create).not.toHaveBeenCalled();
		});
	});

	describe("progress kept between attempts", () => {
		const progress = (pricedGames?: GameTradeInput[]) => ({
			pricedGames,
			savePricedGames: vi.fn(async () => {}),
			saveOutcome: vi.fn(async () => {}),
		});
		const request = {
			...makeRequest([game("Worthy")]),
			supplierSteamId: "76561198012345678",
			currency: "eur" as const,
			requestUuid: "8c1f0000-0000-4000-8000-000000000000",
		};

		it("saves the priced games before calling the Sistema Estoque", async () => {
			const creator = makeCreator();
			const saved = progress();

			await makeUseCase([game("Worthy")], [game("Worthy", 2)], makeImporter(), creator).run(
				request,
				undefined,
				saved,
			);

			expect(saved.savePricedGames).toHaveBeenCalledWith([
				expect.objectContaining({ name: "Worthy", market_price_euro: 2 }),
			]);
			expect(saved.savePricedGames.mock.invocationCallOrder[0]).toBeLessThan(
				creator.create.mock.invocationCallOrder[0],
			);
		});

		it("calls the Sistema Estoque with the saved games, without researching again", async () => {
			// Pesquisar de novo podia não aprovar nenhum jogo (o SteamCharts falha por
			// lote) e o Estoque nem seria chamado, com a Trade da tentativa anterior
			// existindo. Com os mesmos jogos e o `requestUuid`, ele devolve a mesma.
			const popularity = { fetch: vi.fn() } as unknown as PopularityFetcher;
			const creator = makeCreator();
			const useCase = new CreateResearchTrade(
				new PriceGames(popularity, { fetch: vi.fn() } as unknown as PriceFetcher),
				makeImporter(),
				creator,
			);
			const saved: GameTradeInput[] = [
				{
					name: "Worthy",
					market_price_euro: 2,
					popularity: 500,
					region: "global",
					id_steam: null,
					gamivo_id: null,
				},
			];

			const outcome = await useCase.run(request, undefined, progress(saved));

			expect(popularity.fetch).not.toHaveBeenCalled();
			expect(creator.create).toHaveBeenCalledWith(saved, expect.anything());
			expect(outcome).toEqual({
				status: "created",
				tradeUuid: "3a9e0000-0000-4000-8000-000000000000",
			});
		});

		it("does not call the Sistema Estoque with the saved games once the shutdown began", async () => {
			const creator = makeCreator();

			await expect(
				makeUseCase([], [], makeImporter(), creator).run(
					request,
					{ aborted: true },
					progress([
						{
							name: "Worthy",
							market_price_euro: 2,
							popularity: 500,
							region: null,
							id_steam: null,
							gamivo_id: null,
						},
					]),
				),
			).rejects.toBeInstanceOf(ResearchCancelledError);
			expect(creator.create).not.toHaveBeenCalled();
		});
	});
});
