import { describe, it, expect, afterEach, vi } from "vitest";
import {
	fetchGamivoSlug,
	fetchGamivoIdBySlug,
	toOfferPrices,
} from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { GAMIVO_MERCHANT_NAME } from "@/domain/games/pricing-rules.js";
import { GAMIVO_API_PRODUCT_BY_SLUG_URL } from "@/helpers/constants.js";
import type { Price } from "@/infrastructure/games/allkeyshop.types.js";

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

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// toOfferPrices
// ---------------------------------------------------------------------------

describe("toOfferPrices", () => {
	it("returns an empty array when no price matches the region", () => {
		const prices = [makePrice(4.99, { region: "2", merchant: 218 })];
		expect(toOfferPrices(prices, "1", "218")).toHaveLength(0);
	});

	it("filters out prices from other regions", () => {
		const prices = [
			makePrice(0.5, { region: "2", merchant: 218 }),
			makePrice(3.0, { region: "1", merchant: 218 }),
		];
		const result = toOfferPrices(prices, "1", "218");
		expect(result).toHaveLength(1);
		expect(result[0].originalPrice).toBe(3.0);
	});

	it("tags the matching merchant code as Gamivo", () => {
		const prices = [makePrice(0.6, { region: "1", merchant: 218 })];
		const result = toOfferPrices(prices, "1", "218");
		expect(result[0].merchant).toBe(GAMIVO_MERCHANT_NAME);
	});

	it("leaves non-Gamivo merchants as their raw code", () => {
		const prices = [makePrice(1.39, { region: "1", merchant: 61 })];
		const result = toOfferPrices(prices, "1", "218");
		expect(result[0].merchant).toBe("61");
	});

	it("never tags anything as Gamivo when gamivoMerchantKey is null", () => {
		const prices = [makePrice(0.6, { region: "1", merchant: 218 })];
		const result = toOfferPrices(prices, "1", null);
		expect(result[0].merchant).toBe("218");
	});

	it("preserves other Price fields (e.g. id) needed downstream", () => {
		const prices = [makePrice(0.6, { region: "1", merchant: 218, id: 133283219 })];
		const result = toOfferPrices(prices, "1", "218");
		expect(result[0].id).toBe(133283219);
	});
});

// ---------------------------------------------------------------------------
// fetchGamivoSlug
// ---------------------------------------------------------------------------

describe("fetchGamivoSlug", () => {
	it("returns the slug extracted from the redirection page", async () => {
		const html = `<a href="https://www.gamivo.com/product/house-flipper?utm=1">Go</a>`;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => html,
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoSlug(133283219);

		expect(result).toBe("house-flipper");
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/redirection/offer/eur/133283219?locale=en&merchant=218"),
		);
	});

	it("returns null when the redirection page has no Gamivo link", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () => "<html><body>no store link</body></html>",
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoSlug(133283219);

		expect(result).toBeNull();
	});

	it("returns null when the underlying request fails", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoSlug(133283219);

		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// fetchGamivoIdBySlug
// ---------------------------------------------------------------------------

describe("fetchGamivoIdBySlug", () => {
	it("returns the product id as a string on success", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 144601, name: "Beneath Oresa Global", slug: "beneath-oresa" }),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("API_KEY_GAMIVO", "test-token");

		const result = await fetchGamivoIdBySlug("beneath-oresa");

		expect(result).toBe("144601");
		expect(fetchMock).toHaveBeenCalledWith(
			`${GAMIVO_API_PRODUCT_BY_SLUG_URL}/beneath-oresa`,
			expect.objectContaining({
				headers: { Authorization: "Bearer test-token" },
			}),
		);
	});

	it("returns null when the API responds with a non-ok status", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			json: async () => ({}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoIdBySlug("unknown-slug");

		expect(result).toBeNull();
	});

	it("returns null when the response body has no id field", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ name: "No id here" }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoIdBySlug("some-slug");

		expect(result).toBeNull();
	});

	it("returns null when the request throws", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoIdBySlug("some-slug");

		expect(result).toBeNull();
	});

	it("treats id 0 as a valid id (falsy-but-present edge case)", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ id: 0 }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await fetchGamivoIdBySlug("edge-case-slug");

		expect(result).toBe("0");
	});
});
