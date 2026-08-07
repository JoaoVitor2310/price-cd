import { describe, expect, it } from "vitest";
import { hasEdition } from "@/helpers/clear-string.js";
import type {
	Editions,
	Price,
} from "@/infrastructure/games/allkeyshop.types.js";
import {
	findEditionKey,
	toOfferPrices,
} from "@/infrastructure/games/allkeyshop-price-fetcher.js";

const PREY_EDITIONS: Editions = {
	"1": { name: "Standard" },
	"3": { name: "Bonus" },
	"7": { name: "Deluxe" },
	"8": { name: "Bundle" },
	"31": { name: "Dayone" },
	"677": { name: "Anniversary Bundle" },
};

describe("findEditionKey", () => {
	it("resolves to the literal 'Standard' edition when the game name has no edition keyword", () => {
		expect(findEditionKey(PREY_EDITIONS, hasEdition("Prey 2017"))).toBe("1");
	});

	it("does not fall back to an untagged edition like 'Bonus' for a base-name search", () => {
		// 'Bonus' também normaliza para um Set vazio em hasEdition, mas não é a versão base.
		const key = findEditionKey(PREY_EDITIONS, hasEdition("Prey 2017"));
		expect(key).not.toBe("3");
	});

	it("resolves to the matching tier when the game name carries an edition keyword", () => {
		expect(
			findEditionKey(PREY_EDITIONS, hasEdition("Prey 2017 Deluxe Edition")),
		).toBe("7");
	});

	it("matches 'bundle' keyword against a name that also contains other words (Anniversary Bundle)", () => {
		expect(findEditionKey(PREY_EDITIONS, hasEdition("Prey 2017 Bundle"))).toBe(
			"8",
		);
	});

	it("returns null when no edition entry matches the requested tier", () => {
		expect(
			findEditionKey(PREY_EDITIONS, hasEdition("Prey 2017 GOTY")),
		).toBeNull();
	});

	it("returns null for a base-name search when no 'Standard' entry exists", () => {
		const editions: Editions = { "7": { name: "Deluxe" } };
		expect(findEditionKey(editions, hasEdition("Prey 2017"))).toBeNull();
	});
});

describe("toOfferPrices edition filtering", () => {
	const makePrice = (overrides: Partial<Price>): Price => ({
		id: 1,
		originalPrice: 1,
		merchant: 1,
		edition: "1",
		region: "2",
		price: 1,
		pricePaypal: 1,
		feesPaypal: 0,
		priceCard: 1,
		feesCard: 0,
		dispo: 1,
		account: false,
		activationPlatform: "steam",
		...overrides,
	});

	it("excludes offers from a different edition even when region matches", () => {
		const prices = [
			makePrice({ id: 1, originalPrice: 3.02, edition: "7", region: "2" }), // Deluxe - deve ser ignorado
			makePrice({ id: 2, originalPrice: 5.0, edition: "1", region: "2" }), // Standard - deve ficar
		];

		const offers = toOfferPrices(prices, "2", "1", null);

		expect(offers).toHaveLength(1);
		expect(offers[0].id).toBe(2);
	});

	it("keeps only offers matching both region and edition", () => {
		const prices = [
			makePrice({ id: 1, edition: "1", region: "2" }),
			makePrice({ id: 2, edition: "1", region: "9" }),
			makePrice({ id: 3, edition: "7", region: "2" }),
		];

		const offers = toOfferPrices(prices, "2", "1", null);

		expect(offers.map((o) => o.id)).toEqual([1]);
	});
});
