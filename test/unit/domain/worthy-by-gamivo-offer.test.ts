import { describe, expect, it } from "vitest";
import { partitionByGamivoOffer } from "@/domain/games/worthy-by-gamivo-offer.js";

const games = [
	{ name: "On Gamivo", hasGamivoOffer: true },
	{ name: "Off Gamivo", hasGamivoOffer: false },
	{ name: "Unknown" },
];

describe("partitionByGamivoOffer", () => {
	it("keeps everyone when the criteria do not require a Gamivo offer", () => {
		const { worthy, withoutGamivo } = partitionByGamivoOffer(games, false);
		expect(worthy.map((g) => g.name)).toEqual([
			"On Gamivo",
			"Off Gamivo",
			"Unknown",
		]);
		expect(withoutGamivo).toEqual([]);
	});

	it("reports the games without a Gamivo offer instead of dropping them silently", () => {
		const { worthy, withoutGamivo } = partitionByGamivoOffer(games, true);
		expect(worthy.map((g) => g.name)).toEqual(["On Gamivo"]);
		expect(withoutGamivo.map((g) => g.name)).toEqual(["Off Gamivo", "Unknown"]);
	});

	it("returns both sides empty for empty input", () => {
		expect(partitionByGamivoOffer([], true)).toEqual({
			worthy: [],
			withoutGamivo: [],
		});
	});
});
