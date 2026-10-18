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
			lookupPopularity: true,
		});
	});

	it("bundle-research looks popularity up but cuts nobody: not even a game SteamCharts does not know", () => {
		// O fornecedor vende o bundle inteiro, então jogo sem dados no SteamCharts
		// tem que voltar. A consulta é só para informar o número.
		const { popularity, minPrice, lookupPopularity } =
			SEARCH_PRESETS["bundle-research"];

		expect([popularity.upToThreshold, popularity.aboveThreshold]).toEqual([
			0, 0,
		]);
		expect(lookupPopularity).toBe(true);
		expect(minPrice).toBe(0);
	});

	it("bundle-sync skips SteamCharts entirely and drops no cheap game", () => {
		const { popularity, minPrice, lookupPopularity } =
			SEARCH_PRESETS["bundle-sync"];

		expect([popularity.upToThreshold, popularity.aboveThreshold]).toEqual([
			0, 0,
		]);
		expect(lookupPopularity).toBe(false);
		expect(minPrice).toBe(0);
	});

	it("every preset that cuts by popularity looks it up", () => {
		// A consulta precisa existir para o corte ter o que comparar.
		for (const name of SEARCH_PRESET_NAMES) {
			const { popularity, lookupPopularity } = SEARCH_PRESETS[name];
			if (popularity.upToThreshold > 0 || popularity.aboveThreshold > 0) {
				expect(lookupPopularity, name).toBe(true);
			}
		}
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

	it("names the lists preset after what it runs: a supplier's lists", () => {
		expect(SEARCH_PRESET_LABELS.lists).toBe("Supplier Lists");
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
			popularity: {
				upToThreshold: 0,
				aboveThreshold: 30,
				priceThresholdEuro: 5,
			},
			minPrice: 0,
			checkGamivoOffer: true,
			lookupPopularity: true,
		});
	});

	it("lets the request turn the lookup off when no tier needs it", () => {
		const criteria = resolveSearchCriteria("bundle-research", {
			lookupPopularity: false,
		});

		expect(criteria.lookupPopularity).toBe(false);
	});

	it("keeps the lookup on when 0/0 is the only thing that changed on a looking-up preset", () => {
		// A flag vem do preset, não dos tiers: 0/0 no `default` ainda consulta.
		const criteria = resolveSearchCriteria("default", {
			popularity: { upToThreshold: 0, aboveThreshold: 0 },
		});

		expect(criteria.lookupPopularity).toBe(true);
	});

	it("forces the lookup on when a tier above 0 needs the number", () => {
		// `bundle-sync` não consulta; com um tier 30, todo jogo teria popularidade 0 e
		// seria descartado em silêncio. O invariante é resolvido aqui, uma vez.
		const fromPreset = resolveSearchCriteria("bundle-sync", {
			popularity: { upToThreshold: 30 },
		});
		const fromRequest = resolveSearchCriteria("default", {
			lookupPopularity: false,
		});

		expect(fromPreset.lookupPopularity).toBe(true);
		expect(fromRequest.lookupPopularity).toBe(true);
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
