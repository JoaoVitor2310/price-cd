import { describe, it, expect, vi } from "vitest";
import { JobCancelledError } from "@/application/shared/cancellation.js";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import { ListTopic } from "@/domain/lists/list-topic.js";
import { SEARCH_PRESETS } from "@/domain/games/search-presets.js";
import type { ListTopicFetcher, GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import type { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import type { FoundGames } from "@/application/games/game.types.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

/** A porta devolve só os jogos: o `summary` saiu do contrato compartilhado. */
const makePricedGames = (
	overrides: Partial<FoundGames> = {},
): FoundGames[] => [
	{
		id: 0,
		name: "Half-Life",
		popularity: 500,
		region: "global",
		GamivoPrice: 4.5,
		id_steam: "70",
		gamivo_id: "144601",
		...overrides,
	},
];

const makeFetcher = (topics: ListTopic[] = [new ListTopic("http://list", "active", ["Half-Life"])]): ListTopicFetcher => ({
	fetchUserLists: vi.fn().mockResolvedValue(topics),
	fetchList: vi.fn().mockResolvedValue(topics[0]),
});

/** O default de produção; era lido de `process.env` dentro do use case. */
const MAX_ACTIVE_LISTS = 3;

const request: SupplierListRequest = { steam_id: "76561198000000001", checkGamivoOffer: false };

describe("RunListsUseCase", () => {
	it("forwards id_steam and gamivo_id from the priced game to the trade importer", async () => {
		const gameSearcher: GameSearcher = { search: vi.fn().mockResolvedValue(makePricedGames()) };
		const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

		await new RunListsUseCase(
			{ create: () => makeFetcher() },
			gameSearcher,
			tradeImporter,
			MAX_ACTIVE_LISTS,
		).execute({
			supplierListRequest: request,
			checkGamivoOffer: false,
		});

		expect(tradeImporter.import).toHaveBeenCalledWith(
			[expect.objectContaining({ name: "Half-Life", id_steam: "70", gamivo_id: "144601" })],
			{ supplier_steam_id: "76561198000000001" },
		);
	});

	it("sends the market price to the Sistema Estoque as market_price_euro", async () => {
		const gameSearcher: GameSearcher = { search: vi.fn().mockResolvedValue(makePricedGames()) };
		const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

		await new RunListsUseCase(
			{ create: () => makeFetcher() },
			gameSearcher,
			tradeImporter,
			MAX_ACTIVE_LISTS,
		).execute({
			supplierListRequest: request,
			checkGamivoOffer: false,
		});

		const [games] = (tradeImporter.import as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(games[0]).toHaveProperty("market_price_euro");
		expect(games[0]).not.toHaveProperty("price_euro");
	});

	it("sends null for id_steam and gamivo_id when the priced game does not have them", async () => {
		const gameSearcher: GameSearcher = {
			search: vi.fn().mockResolvedValue(makePricedGames({ id_steam: undefined, gamivo_id: undefined })),
		};
		const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

		await new RunListsUseCase(
			{ create: () => makeFetcher() },
			gameSearcher,
			tradeImporter,
			MAX_ACTIVE_LISTS,
		).execute({
			supplierListRequest: request,
			checkGamivoOffer: false,
		});

		const [games] = (tradeImporter.import as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(games[0].id_steam).toBeNull();
		expect(games[0].gamivo_id).toBeNull();
	});

	it("filters out games without a Gamivo price before importing", async () => {
		const gameSearcher: GameSearcher = {
			search: vi.fn().mockResolvedValue(makePricedGames({ GamivoPrice: undefined })),
		};
		const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

		await new RunListsUseCase(
			{ create: () => makeFetcher() },
			gameSearcher,
			tradeImporter,
			MAX_ACTIVE_LISTS,
		).execute({
			supplierListRequest: request,
			checkGamivoOffer: false,
		});

		expect(tradeImporter.import).not.toHaveBeenCalled();
	});

	it("skips a list that could not be read, like an inactive one", async () => {
		const search = vi.fn().mockResolvedValue([]);

		await new RunListsUseCase(
			{
				create: () =>
					makeFetcher([new ListTopic("http://list", "unreadable", [])]),
			},
			{ search },
			{ import: vi.fn() },
			3,
		).execute({
			supplierListRequest: { steam_id: "123", checkGamivoOffer: true },
			checkGamivoOffer: true,
		});

		expect(search).toHaveBeenCalledWith(
			expect.objectContaining({ gameNames: [] }),
		);
	});

	it("skips inactive lists, excluding their games from the search", async () => {
		const inactiveFetcher = makeFetcher([new ListTopic("http://list", "inactive", ["Half-Life"])]);
		const gameSearcher: GameSearcher = {
			search: vi.fn().mockResolvedValue([]),
		};
		const tradeImporter: GameTradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

		await new RunListsUseCase(
			{ create: () => inactiveFetcher },
			gameSearcher,
			tradeImporter,
			MAX_ACTIVE_LISTS,
		).execute({
			supplierListRequest: request,
			checkGamivoOffer: false,
		});

		expect(gameSearcher.search).toHaveBeenCalledWith(
			expect.objectContaining({ gameNames: [] }),
		);
		expect(tradeImporter.import).not.toHaveBeenCalled();
	});

	it("searches with the lists preset, taking only the Gamivo flag from the request", async () => {
		const gameSearcher: GameSearcher = { search: vi.fn().mockResolvedValue([]) };

		await new RunListsUseCase(
			{ create: () => makeFetcher() },
			gameSearcher,
			{ import: vi.fn() },
			MAX_ACTIVE_LISTS,
		).execute({ supplierListRequest: request, checkGamivoOffer: true });

		expect(vi.mocked(gameSearcher.search).mock.calls[0][0].criteria).toEqual({
			...SEARCH_PRESETS.lists,
			checkGamivoOffer: true,
		});
	});

	describe("cancelled by the shutdown", () => {
		it("stops opening the supplier's Lists once the signal is aborted", async () => {
			const signal = { aborted: false };
			const topics = [
				new ListTopic("http://list-1", "active", ["Half-Life"]),
				new ListTopic("http://list-2", "active", ["Portal"]),
			];
			const fetcher = makeFetcher(topics);
			vi.mocked(fetcher.fetchList).mockImplementation(async () => {
				signal.aborted = true;
				return topics[0];
			});
			const gameSearcher: GameSearcher = { search: vi.fn() };

			await expect(
				new RunListsUseCase(
					{ create: () => fetcher },
					gameSearcher,
					{ import: vi.fn() },
					MAX_ACTIVE_LISTS,
				).execute({ supplierListRequest: request, checkGamivoOffer: false }, signal),
			).rejects.toBeInstanceOf(JobCancelledError);
			expect(fetcher.fetchList).toHaveBeenCalledTimes(1);
		});

		it("does not open the price search once the signal is aborted", async () => {
			const gameSearcher: GameSearcher = { search: vi.fn() };
			const tradeImporter: GameTradeImporter = { import: vi.fn() };

			await expect(
				new RunListsUseCase(
					{ create: () => makeFetcher() },
					gameSearcher,
					tradeImporter,
					MAX_ACTIVE_LISTS,
				).execute(
					{ supplierListRequest: request, checkGamivoOffer: false },
					{ aborted: true },
				),
			).rejects.toBeInstanceOf(JobCancelledError);
			expect(gameSearcher.search).not.toHaveBeenCalled();
		});

		it("never creates a Trade from a search the shutdown cut short", async () => {
			// Fechar o browser só transforma os jogos restantes em "sem preço": a
			// Trade nasceria com a lista pela metade, e de novo na reexecução.
			const signal = { aborted: false };
			const gameSearcher: GameSearcher = {
				search: vi.fn(async () => {
					signal.aborted = true;
					return makePricedGames();
				}),
			};
			const tradeImporter: GameTradeImporter = { import: vi.fn() };

			await expect(
				new RunListsUseCase(
					{ create: () => makeFetcher() },
					gameSearcher,
					tradeImporter,
					MAX_ACTIVE_LISTS,
				).execute(
					{ supplierListRequest: request, checkGamivoOffer: false },
					signal,
				),
			).rejects.toBeInstanceOf(JobCancelledError);
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});
	});
});
