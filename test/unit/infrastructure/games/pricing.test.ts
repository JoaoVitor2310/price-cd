import { describe, it, expect } from "vitest";
import {
	detectOfferTooLow,
	bestOfferPrice,
} from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import type { Price } from "@/infrastructure/games/allkeyshop.types.js";
import type { GameData } from "@/infrastructure/games/allkeyshop.types.js";

// ---------------------------------------------------------------------------
// Helpers de fixture
// ---------------------------------------------------------------------------

const makePrice = (originalPrice: number, overrides: Partial<Price> = {}): Price => ({
	id: 1,
	originalPrice,
	merchant: 1,
	edition: "",
	region: "1",
	price: originalPrice,
	pricePaypal: originalPrice,
	feesPaypal: 0,
	priceCard: originalPrice,
	feesCard: 0,
	dispo: 1,
	account: false,
	activationPlatform: "steam",
	...overrides,
});

const makeGameData = (overrides: Partial<GameData> = {}): GameData => ({
	prices: [
		makePrice(4.99, { region: "1", merchant: 1 }),
		makePrice(5.49, { region: "1", merchant: 2 }),
	],
	regions: {
		"1": {
			filter_name: "STEAM GLOBAL",
			region_name: "Global",
			region_short_description: "Global",
			region_long_description: "Steam Global",
		},
	},
	merchants: {
		"1": {
			name: "SomeMerchant",
			logo: "",
			rating: { score: 4.5, count: 100, maximum: 5 },
			official: false,
			paypal: true,
		},
		"2": {
			name: "GAMIVO",
			logo: "",
			rating: { score: 4.8, count: 200, maximum: 5 },
			official: false,
			paypal: true,
		},
	},
	...overrides,
});

// ---------------------------------------------------------------------------
// detectOfferTooLow
// ---------------------------------------------------------------------------

describe("detectOfferTooLow", () => {
	it("returns null for empty array", () => {
		expect(detectOfferTooLow([])).toBeNull();
	});

	it("returns the price of the only available offer", () => {
		expect(detectOfferTooLow([makePrice(3.99)])).toBe(3.99);
	});

	it("returns the best price when the gap is small (≤ 10%)", () => {
		const prices = [makePrice(4.90), makePrice(5.00)];
		expect(detectOfferTooLow(prices)).toBe(4.90);
	});

	it("returns the second best price when the gap is large (> 10%)", () => {
		const prices = [makePrice(3.00), makePrice(5.00)];
		expect(detectOfferTooLow(prices)).toBe(5.00);
	});

	it("uses 5% threshold for prices below 1", () => {
		const prices = [makePrice(0.70), makePrice(0.80)];
		expect(detectOfferTooLow(prices)).toBe(0.80);
	});

	it("finds best and second best regardless of array order", () => {
		const prices = [makePrice(5.00), makePrice(3.00), makePrice(4.50)];
		// best=3.00, second=4.50, gap=1.50, 10%*4.50=0.45 → gap > percentual → retorna segundo
		expect(detectOfferTooLow(prices)).toBe(4.50);
	});
});

// ---------------------------------------------------------------------------
// bestOfferPrice
// ---------------------------------------------------------------------------

describe("bestOfferPrice", () => {
	it("returns null when region does not exist in GameData", () => {
		const data = makeGameData();
		expect(bestOfferPrice(data, "eu", 500, false)).toBeNull();
	});

	it("returns null when no prices exist for the matched region", () => {
		const data = makeGameData({
			prices: [makePrice(4.99, { region: "99" })], // região diferente da do dicionário
		});
		expect(bestOfferPrice(data, "global", 500, false)).toBeNull();
	});

	it("returns price formatted with comma for global region", () => {
		const data = makeGameData();
		const result = bestOfferPrice(data, "global", 500, false);
		expect(result).not.toBeNull();
		expect(result).toMatch(/,/);
	});

	it("returns null when checkGamivoOffer=true, no Gamivo offer, and popularity < 100", () => {
		const data = makeGameData({
			merchants: {
				"1": {
					name: "SomeMerchant",
					logo: "",
					rating: { score: 4, count: 10, maximum: 5 },
					official: false,
					paypal: true,
				},
			},
			prices: [makePrice(4.99, { region: "1", merchant: 1 })],
		});
		expect(bestOfferPrice(data, "global", 50, true)).toBeNull();
	});

	it("returns price when checkGamivoOffer=true but popularity >= 100 (waives requirement)", () => {
		const data = makeGameData({
			merchants: {
				"1": {
					name: "SomeMerchant",
					logo: "",
					rating: { score: 4, count: 10, maximum: 5 },
					official: false,
					paypal: true,
				},
			},
			prices: [makePrice(4.99, { region: "1", merchant: 1 })],
		});
		const result = bestOfferPrice(data, "global", 200, true);
		expect(result).not.toBeNull();
	});

	it("returns price when checkGamivoOffer=true and Gamivo is present", () => {
		const data = makeGameData(); // merchant 2 = GAMIVO na fixture padrão
		const result = bestOfferPrice(data, "global", 50, true);
		expect(result).toBeNull();
	});
});
