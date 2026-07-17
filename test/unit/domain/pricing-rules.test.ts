import { describe, it, expect } from "vitest";
import {
	detectOfferTooLow,
	bestOfferPrice,
	findGamivoOffer,
	GAMIVO_MERCHANT_NAME,
} from "@/domain/games/pricing-rules.js";
import type { OfferPrice } from "@/domain/games/pricing-rules.js";

// ---------------------------------------------------------------------------
// Helpers de fixture
// ---------------------------------------------------------------------------

const makeOffer = (originalPrice: number, overrides: Partial<OfferPrice> = {}): OfferPrice => ({
	merchant: "SomeMerchant",
	originalPrice,
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
		expect(detectOfferTooLow([makeOffer(3.99)])).toBe(3.99);
	});

	it("returns the best price when the gap is small (≤ 10%)", () => {
		const offers = [makeOffer(4.90), makeOffer(5.00)];
		expect(detectOfferTooLow(offers)).toBe(4.90);
	});

	it("returns the second best price when the gap is large (> 10%)", () => {
		const offers = [makeOffer(3.00), makeOffer(5.00)];
		expect(detectOfferTooLow(offers)).toBe(5.00);
	});

	it("uses 5% threshold for prices below 1", () => {
		const offers = [makeOffer(0.70), makeOffer(0.80)];
		expect(detectOfferTooLow(offers)).toBe(0.80);
	});

	it("finds best and second best regardless of array order", () => {
		const offers = [makeOffer(5.00), makeOffer(3.00), makeOffer(4.50)];
		// best=3.00, second=4.50, gap=1.50, 10%*4.50=0.45 → gap > percentual → retorna segundo
		expect(detectOfferTooLow(offers)).toBe(4.50);
	});
});

// ---------------------------------------------------------------------------
// findGamivoOffer
// ---------------------------------------------------------------------------

describe("findGamivoOffer", () => {
	it("returns null when there is no Gamivo offer", () => {
		const offers = [makeOffer(4.99, { merchant: "Steam" })];
		expect(findGamivoOffer(offers)).toBeNull();
	});

	it("returns the Gamivo offer when present", () => {
		const offers = [
			makeOffer(4.99, { merchant: "Steam" }),
			makeOffer(0.6, { merchant: GAMIVO_MERCHANT_NAME }),
		];
		expect(findGamivoOffer(offers)?.originalPrice).toBe(0.6);
	});

	it("returns the cheapest Gamivo offer when there are multiple", () => {
		const offers = [
			makeOffer(2.5, { merchant: GAMIVO_MERCHANT_NAME }),
			makeOffer(0.6, { merchant: GAMIVO_MERCHANT_NAME }),
		];
		expect(findGamivoOffer(offers)?.originalPrice).toBe(0.6);
	});
});

// ---------------------------------------------------------------------------
// bestOfferPrice
// ---------------------------------------------------------------------------

describe("bestOfferPrice", () => {
	it("returns null when there are no offers", () => {
		expect(bestOfferPrice([], 500, false)).toBeNull();
	});

	it("returns price as a number when offers exist", () => {
		const offers = [makeOffer(4.99), makeOffer(5.49, { merchant: GAMIVO_MERCHANT_NAME })];
		const result = bestOfferPrice(offers, 500, false);
		expect(result).not.toBeNull();
		expect(typeof result).toBe("number");
	});

	it("returns null when checkGamivoOffer=true, no Gamivo offer, and popularity < 100", () => {
		const offers = [makeOffer(4.99, { merchant: "Steam" })];
		expect(bestOfferPrice(offers, 50, true)).toBeNull();
	});

	it("returns price when checkGamivoOffer=true but popularity >= 100 (waives requirement)", () => {
		const offers = [makeOffer(4.99, { merchant: "Steam" })];
		const result = bestOfferPrice(offers, 200, true);
		expect(result).not.toBeNull();
	});

	it("returns price when checkGamivoOffer=true and Gamivo is present", () => {
		const offers = [
			makeOffer(4.99, { merchant: "Steam" }),
			makeOffer(5.49, { merchant: GAMIVO_MERCHANT_NAME }),
		];
		const result = bestOfferPrice(offers, 50, true);
		expect(result).not.toBeNull();
	});
});
