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
	it("retorna null para array vazio", () => {
		expect(detectOfferTooLow([])).toBeNull();
	});

	it("retorna o preço da única oferta disponível", () => {
		expect(detectOfferTooLow([makePrice(3.99)])).toBe(3.99);
	});

	it("retorna o melhor preço quando a diferença é pequena (≤ 10%)", () => {
		// gap = 0.10, percentual = 10% de 5.00 = 0.50 → gap < percentual → retorna best
		const prices = [makePrice(4.90), makePrice(5.00)];
		expect(detectOfferTooLow(prices)).toBe(4.90);
	});

	it("retorna o segundo melhor quando a diferença é grande (> 10%)", () => {
		// gap = 2.00, percentual = 10% de 5.00 = 0.50 → gap > percentual → retorna segundo
		const prices = [makePrice(3.00), makePrice(5.00)];
		expect(detectOfferTooLow(prices)).toBe(5.00);
	});

	it("usa threshold de 5% para preços abaixo de 1", () => {
		// gap = 0.10, percentual = 5% de 0.80 = 0.04 → gap > percentual → retorna segundo
		const prices = [makePrice(0.70), makePrice(0.80)];
		expect(detectOfferTooLow(prices)).toBe(0.80);
	});

	it("encontra o melhor e segundo melhor independente de ordem no array", () => {
		const prices = [makePrice(5.00), makePrice(3.00), makePrice(4.50)];
		// best=3.00, second=4.50, gap=1.50, 10%*4.50=0.45 → gap > percentual → retorna segundo
		expect(detectOfferTooLow(prices)).toBe(4.50);
	});
});

// ---------------------------------------------------------------------------
// bestOfferPrice
// ---------------------------------------------------------------------------

describe("bestOfferPrice", () => {
	it("retorna null quando a região não existe no GameData", () => {
		const data = makeGameData();
		expect(bestOfferPrice(data, "eu", 500, false)).toBeNull();
	});

	it("retorna null quando não há preços para a região encontrada", () => {
		const data = makeGameData({
			prices: [makePrice(4.99, { region: "99" })], // região diferente da do dicionário
		});
		expect(bestOfferPrice(data, "global", 500, false)).toBeNull();
	});

	it("retorna preço formatado com vírgula para global", () => {
		const data = makeGameData();
		const result = bestOfferPrice(data, "global", 500, false);
		expect(result).not.toBeNull();
		expect(result).toMatch(/,/); // decimal com vírgula
	});

	it("retorna null quando checkGamivoOffer=true, sem oferta Gamivo e popularidade < 100", () => {
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

	it("retorna preço quando checkGamivoOffer=true mas popularidade >= 100 (dispensa exigência)", () => {
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

	it("retorna preço quando checkGamivoOffer=true e Gamivo está presente", () => {
		const data = makeGameData(); // merchant 2 = GAMIVO na fixture padrão
		const result = bestOfferPrice(data, "global", 50, true);
		expect(result).not.toBeNull();
	});
});
