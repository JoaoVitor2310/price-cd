import { describe, expect, it } from "vitest";
import {
	normalizePopularitySearchName,
	resolvePopularitySearchName,
} from "@/infrastructure/games/steam-charts-popularity-fetcher.js";

describe("resolvePopularitySearchName", () => {
	it("resolves the known 'Prey 2017' exception to the SteamCharts listing name", () => {
		expect(resolvePopularitySearchName("Prey 2017")).toBe("Prey");
	});

	it("matches the alias regardless of case and surrounding whitespace", () => {
		expect(resolvePopularitySearchName("  PREY 2017  ")).toBe("Prey");
	});

	it("leaves unrelated game names untouched", () => {
		expect(resolvePopularitySearchName("House Flipper")).toBe("House Flipper");
	});

	it("does not touch other games that happen to share the same year", () => {
		expect(resolvePopularitySearchName("Skyrim 2017")).toBe("Skyrim 2017");
	});
});

describe("normalizePopularitySearchName", () => {
	it("ignores edition for popularity — 'Deluxe' does not change the search name", () => {
		expect(normalizePopularitySearchName("Prey Deluxe")).toBe("Prey");
	});

	it("strips edition BEFORE resolving the alias, so the compound case matches too", () => {
		// Era o bug real: "Prey 2017 Deluxe" não batia com o alias "prey 2017"
		// porque "Deluxe" ainda estava colado quando o alias era consultado.
		expect(normalizePopularitySearchName("Prey 2017 Deluxe")).toBe("Prey");
	});

	it("still resolves the alias for the plain 'Prey 2017' case", () => {
		expect(normalizePopularitySearchName("Prey 2017")).toBe("Prey");
	});

	it("leaves an unrelated game with no edition or alias untouched", () => {
		expect(normalizePopularitySearchName("House Flipper")).toBe(
			"House Flipper",
		);
	});
});
