import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import { bullmqResearchCheckpoint } from "@/infrastructure/background/bullmq-research-checkpoint.js";

const games: GameTradeInput[] = [
	{
		name: "Hades",
		market_price_euro: 5,
		popularity: 500,
		region: null,
		id_steam: "1145360",
		gamivo_id: null,
	},
];

const job = (data: unknown) => ({
	id: "8c1f",
	data,
	updateData: vi.fn(async (_data: unknown) => {}),
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("bullmqResearchCheckpoint", () => {
	it("starts empty for a job that never saved progress", () => {
		const progress = bullmqResearchCheckpoint(job({ gameNames: ["Hades"] }));

		expect(progress.pricedGames).toBeUndefined();
		expect(progress.outcome).toBeUndefined();
	});

	it("reads what a previous attempt saved", () => {
		const progress = bullmqResearchCheckpoint(
			job({
				gameNames: ["Hades"],
				checkpoint: {
					pricedGames: games,
					outcome: { status: "created", tradeUuid: "3a9e" },
				},
			}),
		);

		expect(progress.pricedGames).toEqual(games);
		expect(progress.outcome).toEqual({ status: "created", tradeUuid: "3a9e" });
	});

	it("keeps the request and adds each milestone to the job data", async () => {
		const stored = job({ gameNames: ["Hades"], requestUuid: "8c1f" });
		const progress = bullmqResearchCheckpoint(stored);

		await progress.savePricedGames(games);
		await progress.saveOutcome({ status: "created", tradeUuid: "3a9e" });

		expect(stored.updateData).toHaveBeenLastCalledWith({
			gameNames: ["Hades"],
			requestUuid: "8c1f",
			checkpoint: {
				pricedGames: games,
				outcome: { status: "created", tradeUuid: "3a9e" },
			},
		});
	});

	it("never throws when saving fails: the next attempt just researches again", async () => {
		const stored = job({ gameNames: ["Hades"] });
		stored.updateData.mockRejectedValue(new Error("Connection is closed."));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(
			bullmqResearchCheckpoint(stored).saveOutcome({
				status: "not_created",
				reason: "nothing_priced",
			}),
		).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("a retry researches again"),
		);
	});

	it("ignores progress it cannot read, rather than trusting it", () => {
		const progress = bullmqResearchCheckpoint(
			job({
				checkpoint: {
					pricedGames: [{ name: "Hades" }],
					outcome: { status: "maybe" },
				},
			}),
		);

		expect(progress.pricedGames).toBeUndefined();
		expect(progress.outcome).toBeUndefined();
	});
});
