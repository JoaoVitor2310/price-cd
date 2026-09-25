import { describe, it, expect, vi } from "vitest";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import { ListTopic } from "@/domain/lists/list-topic.js";
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
});
