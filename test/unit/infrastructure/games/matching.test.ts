import { describe, expect, it } from "vitest";
import type { SearchResult } from "@/infrastructure/games/allkeyshop-html-parser.js";
import { matchSearchResult } from "@/infrastructure/games/allkeyshop-price-fetcher.js";

const makeSearchResult = (
	name: string,
	overrides: Partial<SearchResult> = {},
): SearchResult => ({
	link: "/game/some-link",
	name,
	price: "4,99",
	...overrides,
});

describe("matchSearchResult", () => {
	it("returns null when there are no search results", () => {
		expect(matchSearchResult("House Flipper", [])).toBeNull();
	});

	it("matches a result with the exact same normalized name", () => {
		const results = [
			makeSearchResult("House Flipper", { link: "/game/house-flipper" }),
		];
		const result = matchSearchResult("House Flipper", results);
		expect(result).toEqual({
			link: "/game/house-flipper",
			name: "House Flipper",
		});
	});

	it("matches ignoring case and surrounding whitespace", () => {
		const results = [makeSearchResult("house flipper")];
		const result = matchSearchResult("  House Flipper  ", results);
		expect(result).not.toBeNull();
	});

	it("returns null when no result matches the normalized name", () => {
		const results = [makeSearchResult("Some Other Game")];
		expect(matchSearchResult("House Flipper", results)).toBeNull();
	});

	it("matches across different GOTY spellings (same edition)", () => {
		const results = [
			makeSearchResult("House Flipper GOTY", {
				link: "/game/house-flipper-goty",
			}),
		];
		const result = matchSearchResult(
			"House Flipper Game of the Year Edition",
			results,
		);
		expect(result?.link).toBe("/game/house-flipper-goty");
	});

	it("matches a base query against a 'Standard Edition' listing (standard = base)", () => {
		const results = [
			makeSearchResult("House Flipper Standard Edition", {
				link: "/game/house-flipper",
			}),
		];
		const result = matchSearchResult("House Flipper", results);
		expect(result?.link).toBe("/game/house-flipper");
	});

	// -------------------------------------------------------------------------
	// Único candidato: a edição mora dentro da página, não no título do
	// resultado (caso "Prey 2017" — a busca nunca leva "Deluxe Edition" na
	// query, então o único listing existente para o jogo é aceito mesmo que o
	// título não mencione a edição pedida).
	// -------------------------------------------------------------------------

	it("accepts the sole candidate even when its title doesn't reflect the requested edition", () => {
		const results = [
			makeSearchResult("Prey 2017", { link: "/game/prey-2017" }),
		];
		const result = matchSearchResult("Prey 2017 Deluxe Edition", results);
		expect(result?.link).toBe("/game/prey-2017");
	});

	it("accepts the sole candidate even when its title carries an edition the query didn't ask for", () => {
		const results = [
			makeSearchResult("House Flipper Deluxe Edition", {
				link: "/game/house-flipper-deluxe",
			}),
		];
		const result = matchSearchResult("House Flipper", results);
		expect(result?.link).toBe("/game/house-flipper-deluxe");
	});

	// -------------------------------------------------------------------------
	// Múltiplos candidatos com o mesmo nome-base: a edição é usada como
	// desempate (caso "Skyrim" — "Skyrim Special Edition" (2021) e "Skyrim"
	// (2011) são produtos DIFERENTES no catálogo do AllKeyShop, não a mesma
	// página com preços por edição).
	// -------------------------------------------------------------------------

	describe("multiple candidates sharing the same base name (separate catalog products)", () => {
		const skyrimResults = [
			makeSearchResult("Skyrim Special Edition", {
				link: "/game/skyrim-special-edition",
			}),
			makeSearchResult("Skyrim", { link: "/game/skyrim" }),
		];

		it("picks the plain listing when the query has no edition keyword", () => {
			const result = matchSearchResult("Skyrim", skyrimResults);
			expect(result?.link).toBe("/game/skyrim");
		});

		it("picks the edition-tagged listing when the query asks for that edition", () => {
			const result = matchSearchResult("Skyrim Special Edition", skyrimResults);
			expect(result?.link).toBe("/game/skyrim-special-edition");
		});

		it("falls back to the first candidate when neither matches the requested edition exactly", () => {
			// Pediu GOTY, mas só existem Standard e Special Edition — nenhum bate exato.
			const result = matchSearchResult("Skyrim GOTY", skyrimResults);
			expect(result?.link).toBe("/game/skyrim-special-edition");
		});
	});

	it("returns the first matching result and ignores the rest", () => {
		const results = [
			makeSearchResult("Other Game"),
			makeSearchResult("House Flipper", { link: "/game/first-match" }),
			makeSearchResult("House Flipper", { link: "/game/second-match" }),
		];
		const result = matchSearchResult("House Flipper", results);
		expect(result?.link).toBe("/game/first-match");
	});
});
