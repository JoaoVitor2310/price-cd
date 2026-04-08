import { describe, it, expect } from "vitest";
import {
	clearString,
	clearEdition,
	clearDLC,
	hasEdition,
	getRegion,
	removeRegion,
} from "@/helpers/clear-string.js";

// ---------------------------------------------------------------------------
// clearString
// ---------------------------------------------------------------------------

describe("clearString", () => {
	it("converts standalone roman numeral to decimal", () => {
		expect(clearString("Fallout IV")).toBe("fallout 4");
	});

	it("does not convert roman numeral attached to number (e.g. x2)", () => {
		const result = clearString("Game x2");
		expect(result).not.toContain("102");
	});

	it("removes suffix quantity indicator (x2)", () => {
		expect(clearString("Pain Train PainPocalypse x2").trim()).toBe(
			"pain train painpocalypse",
		);
	});

	it("removes prefix quantity indicator (2x)", () => {
		expect(clearString("2x Game").trim()).toBe("game");
	});

	it("removes quantity indicator case-insensitively (X3)", () => {
		expect(clearString("Game X3").trim()).toBe("game");
	});

	it("expands K-suffixed number to integer", () => {
		expect(clearString("10k")).toBe("10000");
	});

	it("expands decimal K-number (dot removed before expansion, becomes integer * 1000)", () => {
		expect(clearString("1.5k")).toBe("15000");
	});

	it("removes dash and converts to lowercase", () => {
		expect(clearString("Dark-Souls")).toBe("darksouls");
	});

	it("removes special characters ™ : ® ! ? and also removes 'the'", () => {
		expect(clearString("Game™: The® Adventure!?")).toBe("game adventure");
	});

	it("removes 'the' as a standalone word", () => {
		expect(clearString("The Witcher")).toBe("witcher");
	});

	it("removes commas", () => {
		expect(clearString("Hello, World")).toBe("hello world");
	});

	it("removes /mx case-insensitively", () => {
		expect(clearString("Game/MX Edition")).toBe("game edition");
	});

	it("standalone 'x' is treated as roman numeral X (becomes 10)", () => {
		const result = clearString("Street Fighter X Tekken");
		expect(result).toBe("street fighter 10 tekken");
	});
});

// ---------------------------------------------------------------------------
// clearEdition
// ---------------------------------------------------------------------------

describe("clearEdition", () => {
	it("removes 'Edition'", () => {
		expect(clearEdition("Game Edition").trim()).toBe("Game");
	});

	it("removes 'Definitive'", () => {
		expect(clearEdition("Game Definitive Edition").trim()).toBe("Game");
	});

	it("removes 'GOTY'", () => {
		expect(clearEdition("Game GOTY").trim()).toBe("Game");
	});

	it("removes 'Game of the Year'", () => {
		expect(clearEdition("Game Game of the Year").trim()).toBe("Game");
	});

	it("removes 'Deluxe'", () => {
		expect(clearEdition("Game Deluxe Edition").trim()).toBe("Game");
	});

	it("removes 'Premium'", () => {
		expect(clearEdition("Game Premium Edition").trim()).toBe("Game");
	});

	it("removes 'Bundle'", () => {
		expect(clearEdition("Game Bundle").trim()).toBe("Game");
	});

	it("removes 'Special'", () => {
		expect(clearEdition("Game Special Edition").trim()).toBe("Game");
	});

	it("removes 'Complete'", () => {
		expect(clearEdition("Game Complete Edition").trim()).toBe("Game");
	});

	it("removes 'Day One'", () => {
		expect(clearEdition("Game Day One Edition").trim()).toBe("Game");
	});

	it("removes 'ROW' as standalone word", () => {
		expect(clearEdition("Game ROW").trim()).toBe("Game");
	});

	it("removes 'EU' as standalone word", () => {
		expect(clearEdition("Game EU").trim()).toBe("Game");
	});

	it("does not alter name without edition keywords", () => {
		expect(clearEdition("The Witcher 3").trim()).toBe("The Witcher 3");
	});
});

// ---------------------------------------------------------------------------
// clearDLC
// ---------------------------------------------------------------------------

describe("clearDLC", () => {
	it("removes 'DLC' as standalone word", () => {
		expect(clearDLC("Game DLC")).toBe("Game");
	});

	it("removes 'expansion'", () => {
		expect(clearDLC("Game Expansion")).toBe("Game");
	});

	it("removes 'season'", () => {
		expect(clearDLC("Game Season")).toBe("Game");
	});

	it("removes 'pass'", () => {
		expect(clearDLC("Game Pass")).toBe("Game");
	});

	it("does not remove 'DLC' embedded in a word", () => {
		// \b garante que só remove como palavra separada
		expect(clearDLC("ClassicDLC")).toBe("ClassicDLC");
	});
});

// ---------------------------------------------------------------------------
// hasEdition
// ---------------------------------------------------------------------------

describe("hasEdition", () => {
	it("returns empty set for name without edition keywords", () => {
		expect(hasEdition("The Witcher 3").size).toBe(0);
	});

	it("detects 'edition'", () => {
		const result = hasEdition("Game Edition");
		expect(result.size).toBeGreaterThan(0);
	});

	it("detects both 'GOTY' and 'edition'", () => {
		const result = hasEdition("Game GOTY Edition");
		expect(result.size).toBe(2);
	});

	it("detects 'deluxe'", () => {
		const result = hasEdition("Game Deluxe");
		expect(result.size).toBe(1);
	});

	it("symmetric match: same set for two equivalent names", () => {
		const a = hasEdition("Game Deluxe Edition");
		const b = hasEdition("Game Deluxe Edition");
		expect([...a].every((k) => b.has(k))).toBe(true);
		expect([...b].every((k) => a.has(k))).toBe(true);
	});

	it("asymmetric match: names with different editions do not match", () => {
		const a = hasEdition("Game Deluxe Edition");
		const b = hasEdition("Game Standard Edition");
		const allMatch = [...a].every((k) => b.has(k)) && [...b].every((k) => a.has(k));
		expect(allMatch).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// getRegion
// ---------------------------------------------------------------------------

describe("getRegion", () => {
	it("returns 'row' when ROW is found", () => {
		expect(getRegion("Game ROW")).toBe("row");
	});

	it("returns 'eu' when EU is found", () => {
		expect(getRegion("Game EU")).toBe("eu");
	});

	it("returns 'global' when no region is found", () => {
		expect(getRegion("Game")).toBe("global");
	});

	it("is case-insensitive for row", () => {
		expect(getRegion("game row")).toBe("row");
	});
});

// ---------------------------------------------------------------------------
// removeRegion
// ---------------------------------------------------------------------------

describe("removeRegion", () => {
	it("removes 'ROW' from string", () => {
		expect(removeRegion("Game ROW").trim()).toBe("Game");
	});

	it("removes 'EU' from string", () => {
		expect(removeRegion("Game EU").trim()).toBe("Game");
	});

	it("does not alter string without region", () => {
		expect(removeRegion("The Witcher 3")).toBe("The Witcher 3");
	});
});
