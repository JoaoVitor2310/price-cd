import { describe, expect, it } from "vitest";
import { HaveListing } from "@/domain/lists/have-listing.js";

/** Formato real de uma Lista mista, como o Fornecedor escreve no `.have`. */
const MIXED_LISTING = `
Steam:

Half-Life 2
Portal 2

GOG:

Mystic Academy: Escape Room
XCOM: Chimera Squad
Right and Down
`;

describe("HaveListing.parse", () => {
	it("keeps every game when the listing declares no platform", () => {
		const listing = HaveListing.parse("Hades\nCeleste\nHollow Knight");

		expect(listing.priceableGames).toEqual([
			"Hades",
			"Celeste",
			"Hollow Knight",
		]);
		expect(listing.skippedSections).toEqual([]);
	});

	it("drops the games listed under a GOG header", () => {
		const listing = HaveListing.parse(MIXED_LISTING);

		expect(listing.priceableGames).toEqual(["Half-Life 2", "Portal 2"]);
	});

	it("reports what it skipped so the caller can log it", () => {
		const listing = HaveListing.parse(MIXED_LISTING);

		expect(listing.skippedSections).toEqual([
			{
				platform: "GOG",
				games: [
					"Mystic Academy: Escape Room",
					"XCOM: Chimera Squad",
					"Right and Down",
				],
			},
		]);
	});

	it("does not mistake a colon inside a game name for a section header", () => {
		// "XCOM: Chimera Squad" tem texto depois dos dois-pontos — não é cabeçalho.
		const listing = HaveListing.parse("XCOM: Chimera Squad\nPortal 2");

		expect(listing.priceableGames).toEqual(["XCOM: Chimera Squad", "Portal 2"]);
		expect(listing.skippedSections).toEqual([]);
	});

	it("keeps games listed before any header", () => {
		const listing = HaveListing.parse("Hades\n\nGOG:\n\nRight and Down");

		expect(listing.priceableGames).toEqual(["Hades"]);
	});

	it("matches the platform case-insensitively and with extra words", () => {
		const listing = HaveListing.parse("Hades\ngog keys:\nRight and Down");

		expect(listing.priceableGames).toEqual(["Hades"]);
		expect(listing.skippedSections[0].platform).toBe("gog keys");
	});

	it.each([["GOG"], ["gog"], ["GOG Keys"], ["GOG-Galaxy"]])(
		"drops the games listed under a %s header",
		(platform) => {
			const listing = HaveListing.parse(
				`Half-Life 2\n${platform}:\nRight and Down`,
			);

			expect(listing.priceableGames).toEqual(["Half-Life 2"]);
			expect(listing.skippedSections[0].platform).toBe(platform);
		},
	);

	it("matches the platform as a whole word, not as a substring", () => {
		// Guarda o invariante que torna seguro reativar "ea" na lista de
		// plataformas: com match por substring, "ea" casaria dentro de
		// "st(ea)m" e toda seção Steam declarada sumiria em silêncio.
		const listing = HaveListing.parse(
			"Steam:\nHalf-Life 2\nGogo Bar:\nCeleste",
		);

		expect(listing.priceableGames).toEqual(["Half-Life 2", "Celeste"]);
		expect(listing.skippedSections).toEqual([]);
	});

	it("keeps games under a platform that is commented out of the list", () => {
		// Hoje só GOG é descartado; Epic e afins estão desligados de propósito.
		const listing = HaveListing.parse("Epic:\nAlan Wake 2\nEA App:\nIt Takes Two");

		expect(listing.priceableGames).toEqual(["Alan Wake 2", "It Takes Two"]);
	});

	it("resumes pricing games when a later header names a supported platform", () => {
		const listing = HaveListing.parse(
			"GOG:\nRight and Down\nSteam:\nHalf-Life 2",
		);

		expect(listing.priceableGames).toEqual(["Half-Life 2"]);
	});

	it("drops blank lines instead of emitting empty game names", () => {
		const listing = HaveListing.parse("Hades\n\n   \nCeleste\n");

		expect(listing.priceableGames).toEqual(["Hades", "Celeste"]);
	});

	it("returns nothing for an empty listing", () => {
		expect(HaveListing.parse("").priceableGames).toEqual([]);
		expect(HaveListing.parse("   \n\n").sections).toEqual([]);
	});
});
