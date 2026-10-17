import { describe, expect, it } from "vitest";
import {
	resolveSearchCriteria,
	SEARCH_PRESET_LABELS,
	SEARCH_PRESET_NAMES,
	SEARCH_PRESETS,
} from "@/domain/games/search-presets.js";

describe("SEARCH_PRESETS", () => {
	it("has a preset for every declared name", () => {
		expect(Object.keys(SEARCH_PRESETS).sort()).toEqual([...SEARCH_PRESET_NAMES].sort());
	});

	it("default: tiers 30/100 at €5, €0.50 floor, Gamivo offer required", () => {
		expect(SEARCH_PRESETS.default).toEqual({
			popularity: { upToThreshold: 30, aboveThreshold: 100, priceThresholdEuro: 5 },
			minPrice: 0.5,
			checkGamivoOffer: true,
		});
	});

	it("bundle-research looks popularity up (1) but drops no cheap game", () => {
		const { popularity, minPrice } = SEARCH_PRESETS["bundle-research"];

		expect([popularity.upToThreshold, popularity.aboveThreshold]).toEqual([1, 1]);
		expect(minPrice).toBe(0);
	});

	it("bundle-sync skips SteamCharts entirely (0 in both tiers) and drops no cheap game", () => {
		const { popularity, minPrice } = SEARCH_PRESETS["bundle-sync"];

		expect([popularity.upToThreshold, popularity.aboveThreshold]).toEqual([0, 0]);
		expect(minPrice).toBe(0);
	});

	it("suppliers requires a Gamivo offer, since the offer is built from its price", () => {
		expect(SEARCH_PRESETS.suppliers.checkGamivoOffer).toBe(true);
	});

	it("lists requires a Gamivo offer, matching the /lists/run request default", () => {
		// O `supplierListRequestSchema` tem `checkGamivoOffer` com default `true`; um
		// preset diferente publicaria em `GET /presets` um valor que nunca vale.
		expect(SEARCH_PRESETS.lists.checkGamivoOffer).toBe(true);
	});

	it("lists and suppliers share the default tiers and floor", () => {
		for (const name of ["lists", "suppliers"] as const) {
			expect(SEARCH_PRESETS[name].popularity).toEqual(SEARCH_PRESETS.default.popularity);
			expect(SEARCH_PRESETS[name].minPrice).toBe(SEARCH_PRESETS.default.minPrice);
		}
	});

	it("cannot be mutated by a caller, nested tiers included", () => {
		expect(Object.isFrozen(SEARCH_PRESETS.lists)).toBe(true);
		expect(Object.isFrozen(SEARCH_PRESETS.lists.popularity)).toBe(true);
	});
});

describe("SEARCH_PRESET_LABELS", () => {
	it("gives every preset a non-empty, unique human name", () => {
		const labels = SEARCH_PRESET_NAMES.map((name) => SEARCH_PRESET_LABELS[name]);

		expect(labels.every((label) => label.trim().length > 0)).toBe(true);
		expect(new Set(labels).size).toBe(labels.length);
	});

	it("never leaks into the resolved criteria", () => {
		expect(resolveSearchCriteria("bundle-research")).not.toHaveProperty("label");
	});
});

describe("resolveSearchCriteria", () => {
	it("falls back to the default preset", () => {
		expect(resolveSearchCriteria()).toEqual(SEARCH_PRESETS.default);
	});

	it("lets explicit values override the preset field by field", () => {
		const criteria = resolveSearchCriteria("bundle-research", {
			popularity: { aboveThreshold: 30 },
			checkGamivoOffer: true,
		});

		expect(criteria).toEqual({
			popularity: { upToThreshold: 1, aboveThreshold: 30, priceThresholdEuro: 5 },
			minPrice: 0,
			checkGamivoOffer: true,
		});
	});

	it("ignores fields sent as undefined instead of erasing the preset value", () => {
		const criteria = resolveSearchCriteria("suppliers", {
			minPrice: undefined,
			popularity: { upToThreshold: undefined },
		});

		expect(criteria).toEqual(SEARCH_PRESETS.suppliers);
	});

	it("keeps 0 as a real override, not as a missing value", () => {
		expect(resolveSearchCriteria("default", { minPrice: 0 }).minPrice).toBe(0);
	});

	it("returns a fresh object, never the frozen preset itself", () => {
		const criteria = resolveSearchCriteria("lists");

		expect(criteria).not.toBe(SEARCH_PRESETS.lists);
		expect(criteria.popularity).not.toBe(SEARCH_PRESETS.lists.popularity);
	});
});
