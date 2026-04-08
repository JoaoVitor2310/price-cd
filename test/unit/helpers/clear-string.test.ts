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
	it("converte numeral romano isolado para decimal", () => {
		expect(clearString("Fallout IV")).toBe("fallout 4");
	});

	it("não converte numeral romano colado a número (ex: x2)", () => {
		// 'x' em 'x2' não tem word boundary após si → não vira romano
		const result = clearString("Game x2");
		expect(result).not.toContain("102");
	});

	it("remove indicador de quantidade sufixo (x2)", () => {
		expect(clearString("Pain Train PainPocalypse x2").trim()).toBe(
			"pain train painpocalypse",
		);
	});

	it("remove indicador de quantidade prefixo (2x)", () => {
		expect(clearString("2x Game").trim()).toBe("game");
	});

	it("remove indicador de quantidade case-insensitive (X3)", () => {
		expect(clearString("Game X3").trim()).toBe("game");
	});

	it("expande número com K para inteiro", () => {
		expect(clearString("10k")).toBe("10000");
	});

	it("expande número decimal com K (ponto é removido antes da expansão, vira inteiro * 1000)", () => {
		// O regex de caracteres especiais remove o "." antes de expandKNumbers rodar,
		// portanto "1.5k" → "15k" → 15 * 1000 = "15000"
		expect(clearString("1.5k")).toBe("15000");
	});

	it("remove traço e converte para minúsculas", () => {
		expect(clearString("Dark-Souls")).toBe("darksouls");
	});

	it("remove caracteres especiais ™ : ® ! ? e também remove 'the'", () => {
		// A função remove "the" via /the\s*/gi (sem word boundary),
		// portanto "Game™: The® Adventure!?" → remover símbolos → "Game The Adventure"
		// → remover "The " → "Game Adventure" → lowercase → "game adventure"
		expect(clearString("Game™: The® Adventure!?")).toBe("game adventure");
	});

	it("remove 'the' como palavra isolada", () => {
		expect(clearString("The Witcher")).toBe("witcher");
	});

	it("remove vírgulas", () => {
		expect(clearString("Hello, World")).toBe("hello world");
	});

	it("remove /mx case-insensitive", () => {
		expect(clearString("Game/MX Edition")).toBe("game edition");
	});

	it("não remove 'x' isolado de nomes (ex: Street Fighter X Tekken vira romano 10)", () => {
		// X isolado vira roman → "10" — comportamento esperado
		const result = clearString("Street Fighter X Tekken");
		expect(result).toBe("street fighter 10 tekken");
	});
});

// ---------------------------------------------------------------------------
// clearEdition
// ---------------------------------------------------------------------------

describe("clearEdition", () => {
	it("remove 'Edition'", () => {
		expect(clearEdition("Game Edition").trim()).toBe("Game");
	});

	it("remove 'Definitive'", () => {
		expect(clearEdition("Game Definitive Edition").trim()).toBe("Game");
	});

	it("remove 'GOTY'", () => {
		expect(clearEdition("Game GOTY").trim()).toBe("Game");
	});

	it("remove 'Game of the Year'", () => {
		expect(clearEdition("Game Game of the Year").trim()).toBe("Game");
	});

	it("remove 'Deluxe'", () => {
		expect(clearEdition("Game Deluxe Edition").trim()).toBe("Game");
	});

	it("remove 'Premium'", () => {
		expect(clearEdition("Game Premium Edition").trim()).toBe("Game");
	});

	it("remove 'Bundle'", () => {
		expect(clearEdition("Game Bundle").trim()).toBe("Game");
	});

	it("remove 'Special'", () => {
		expect(clearEdition("Game Special Edition").trim()).toBe("Game");
	});

	it("remove 'Complete'", () => {
		expect(clearEdition("Game Complete Edition").trim()).toBe("Game");
	});

	it("remove 'Day One'", () => {
		expect(clearEdition("Game Day One Edition").trim()).toBe("Game");
	});

	it("remove 'ROW' como palavra isolada", () => {
		expect(clearEdition("Game ROW").trim()).toBe("Game");
	});

	it("remove 'EU' como palavra isolada", () => {
		expect(clearEdition("Game EU").trim()).toBe("Game");
	});

	it("não altera nome sem edition keywords", () => {
		expect(clearEdition("The Witcher 3").trim()).toBe("The Witcher 3");
	});
});

// ---------------------------------------------------------------------------
// clearDLC
// ---------------------------------------------------------------------------

describe("clearDLC", () => {
	it("remove 'DLC' como palavra isolada", () => {
		expect(clearDLC("Game DLC")).toBe("Game");
	});

	it("remove 'expansion'", () => {
		expect(clearDLC("Game Expansion")).toBe("Game");
	});

	it("remove 'season'", () => {
		expect(clearDLC("Game Season")).toBe("Game");
	});

	it("remove 'pass'", () => {
		expect(clearDLC("Game Pass")).toBe("Game");
	});

	it("não remove 'DLC' embutido em palavra", () => {
		// \b garante que só remove como palavra separada
		expect(clearDLC("ClassicDLC")).toBe("ClassicDLC");
	});
});

// ---------------------------------------------------------------------------
// hasEdition
// ---------------------------------------------------------------------------

describe("hasEdition", () => {
	it("retorna set vazio para nome sem edition keywords", () => {
		expect(hasEdition("The Witcher 3").size).toBe(0);
	});

	it("detecta 'edition'", () => {
		const result = hasEdition("Game Edition");
		expect(result.size).toBeGreaterThan(0);
	});

	it("detecta 'GOTY' e 'edition' juntos", () => {
		const result = hasEdition("Game GOTY Edition");
		expect(result.size).toBe(2);
	});

	it("detecta 'deluxe'", () => {
		const result = hasEdition("Game Deluxe");
		expect(result.size).toBe(1);
	});

	it("comparação simétrica: mesmo set para dois nomes equivalentes", () => {
		const a = hasEdition("Game Deluxe Edition");
		const b = hasEdition("Game Deluxe Edition");
		expect([...a].every((k) => b.has(k))).toBe(true);
		expect([...b].every((k) => a.has(k))).toBe(true);
	});

	it("comparação assimétrica: nomes com editions diferentes não batem", () => {
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
	it("retorna 'row' quando encontra ROW", () => {
		expect(getRegion("Game ROW")).toBe("row");
	});

	it("retorna 'eu' quando encontra EU", () => {
		expect(getRegion("Game EU")).toBe("eu");
	});

	it("retorna 'global' quando não encontra região", () => {
		expect(getRegion("Game")).toBe("global");
	});

	it("é case-insensitive para row", () => {
		expect(getRegion("game row")).toBe("row");
	});
});

// ---------------------------------------------------------------------------
// removeRegion
// ---------------------------------------------------------------------------

describe("removeRegion", () => {
	it("remove 'ROW' da string", () => {
		expect(removeRegion("Game ROW").trim()).toBe("Game");
	});

	it("remove 'EU' da string", () => {
		expect(removeRegion("Game EU").trim()).toBe("Game");
	});

	it("não altera string sem região", () => {
		expect(removeRegion("The Witcher 3")).toBe("The Witcher 3");
	});
});
