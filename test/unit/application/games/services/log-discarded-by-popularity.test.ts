import { afterEach, describe, expect, it, vi } from "vitest";
import { logDiscardedByPopularityTier } from "@/application/games/services/log-discarded-by-popularity.js";

const tiers = { upToThreshold: 10, aboveThreshold: 100, priceThresholdEuro: 5 };

afterEach(() => {
	vi.restoreAllMocks();
});

describe("logDiscardedByPopularityTier", () => {
	it("names the game, its popularity and the minimum of its price tier", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPopularityTier([{ name: "Pricey", popularity: 40, GamivoPrice: 12 }], tiers);

		expect(log).toHaveBeenCalledWith(
			'👥 [INFO] Discarded "Pricey" — popularity 40 is below 100, the minimum for games priced above €5.00 (€12.00).',
		);
	});

	it("reports a price exactly at the threshold as the lower tier", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPopularityTier([{ name: "Edge", popularity: 3, GamivoPrice: 5 }], tiers);

		expect(log).toHaveBeenCalledWith(expect.stringContaining("is below 10, the minimum for games priced up to €5.00 (€5.00)"));
	});

	it("logs one line per discarded game and nothing for an empty list", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPopularityTier([], tiers);
		expect(log).not.toHaveBeenCalled();

		logDiscardedByPopularityTier(
			[
				{ name: "A", popularity: 1, GamivoPrice: 2 },
				{ name: "B", popularity: 2, GamivoPrice: 20 },
			],
			tiers,
		);
		expect(log).toHaveBeenCalledTimes(2);
	});
});
