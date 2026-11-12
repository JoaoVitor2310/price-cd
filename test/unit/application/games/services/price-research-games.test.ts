import { afterEach, describe, expect, it, vi } from "vitest";
import type { FoundGames } from "@/application/games/game.types.js";
import type {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { priceResearchGames } from "@/application/games/services/price-research-games.js";
import { flatPopularity } from "@/domain/games/search-criteria.js";

const game = (name: string, overrides: Partial<FoundGames> = {}): FoundGames => ({
	id: 0,
	name,
	popularity: 500,
	...overrides,
});

const setup = (
	found: FoundGames[],
	priced: FoundGames[],
	failed: string[] = [],
) => {
	const popularity = {
		fetch: vi.fn().mockResolvedValue(found),
	} as PopularityFetcher;
	const priceGames = new PriceGames(popularity, {
		fetch: vi.fn().mockResolvedValue({ games: priced, failed }),
	} as PriceFetcher);
	return { popularity, priceGames };
};

const request = (gameNames: string[]) => ({
	gameNames,
	criteria: {
		popularity: flatPopularity(100),
		minPrice: 0.5,
		checkGamivoOffer: false,
	},
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("priceResearchGames", () => {
	it("searches each name once", async () => {
		const { popularity, priceGames } = setup([game("Hades")], []);

		await priceResearchGames(priceGames, request(["Hades", "Hades"]));

		expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
	});

	it("cuts the list before searching when there is a limit", async () => {
		const { popularity, priceGames } = setup([game("Hades")], []);

		await priceResearchGames(priceGames, request(["Hades", "Rust"]), 1);

		expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
	});

	describe("a List pasted with the supplier's section headers", () => {
		it("never searches a header, and logs it", async () => {
			const { popularity, priceGames } = setup([game("Hades")], []);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});

			await priceResearchGames(priceGames, request(["Keys:", "Hades"]));

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
			expect(log).toHaveBeenCalledWith(
				'⏭️ [INFO] "Keys:" is a section header, not a game — ignored.',
			);
			log.mockRestore();
		});

		it("drops the games under GOG, and logs how many", async () => {
			const { popularity, priceGames } = setup([game("Hades")], []);
			const log = vi.spyOn(console, "log").mockImplementation(() => {});

			await priceResearchGames(
				priceGames,
				request(["Hades", "GOG:", "Right and Down", "Wizorb"]),
			);

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
			expect(log).toHaveBeenCalledWith(
				'⏭️ [INFO] 2 game(s) under "GOG" ignored — that platform cannot be priced yet.',
			);
			log.mockRestore();
		});

		it("reads the sections before removing repeated names, so no game changes section", async () => {
			// Deduplicar antes tiraria o segundo `GOG:`, e Celeste cairia em `Keys`.
			const { popularity, priceGames } = setup([game("Hades")], []);
			vi.spyOn(console, "log").mockImplementation(() => {});

			await priceResearchGames(
				priceGames,
				request(["GOG:", "Inside", "Keys:", "Hades", "GOG:", "Celeste"]),
			);

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
		});

		it("keeps a game listed under GOG and under Steam, by its Steam entry", async () => {
			const { popularity, priceGames } = setup([game("Hades")], []);
			vi.spyOn(console, "log").mockImplementation(() => {});

			await priceResearchGames(
				priceGames,
				request(["GOG:", "Hades", "Steam:", "Hades"]),
			);

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual(["Hades"]);
		});

		it("does not let headers and GOG games use up the demo limit", async () => {
			const { popularity, priceGames } = setup([game("Hades")], []);
			vi.spyOn(console, "log").mockImplementation(() => {});

			await priceResearchGames(
				priceGames,
				request(["Keys:", "GOG:", "Inside", "Steam:", "Hades", "Celeste"]),
				2,
			);

			expect(vi.mocked(popularity.fetch).mock.calls[0][0]).toEqual([
				"Hades",
				"Celeste",
			]);
		});
	});

	it("maps a priced game to the outgoing format, with null for what is missing", async () => {
		const { priceGames } = setup(
			[game("Hades")],
			[game("Hades", { GamivoPrice: 2 })],
		);

		await expect(
			priceResearchGames(priceGames, request(["Hades"])),
		).resolves.toEqual({
			games: [
				{
					name: "Hades",
					market_price_euro: 2,
					popularity: 500,
					region: null,
					id_steam: null,
					gamivo_id: null,
				},
			],
			lookupFailed: [],
		});
	});

	it("reports the names the catalog could not answer", async () => {
		const { priceGames } = setup([game("Hades")], [], ["Hades"]);

		const { lookupFailed } = await priceResearchGames(
			priceGames,
			request(["Hades"]),
		);

		expect(lookupFailed).toEqual(["Hades"]);
	});
});
