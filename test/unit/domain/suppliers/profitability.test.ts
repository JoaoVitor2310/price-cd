import { describe, it, expect } from "vitest";
import { formatResult } from "@/domain/suppliers/profitability.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

const makeGame = (overrides: Partial<ProfitableGameResult> = {}): ProfitableGameResult => ({
    name: "Half-Life",
    price_euro: 4.50,
    popularity: 500,
    region: "global",
    tf2_price: 2.10,
    ...overrides,
});

describe("formatResult", () => {
    it("returns one line per game in TSV format with correct column positions", () => {
        const result = formatResult([makeGame()]);
        // \t{date}\t{price}\t\t\t\t\t{pop}\t{region}\t\t{name}
        //  [0]""  [1]date  [2]price [3..6]"" [7]pop  [8]region [9]"" [10]name
        const parts = result.split("\t");
        expect(parts[0]).toBe("");
        expect(parts[2]).toBe("4.50");
        expect(parts[7]).toBe("500");
        expect(parts[8]).toBe("global");
        expect(parts[10]).toBe("Half-Life");
    });

    it("uses dot as decimal separator for price", () => {
        const result = formatResult([makeGame({ price_euro: 3.99 })]);
        expect(result).toContain("3.99");
        expect(result).not.toContain("3,99");
    });

    it("formats price with exactly two decimal places", () => {
        const result = formatResult([makeGame({ price_euro: 2.1 })]);
        expect(result).toContain("2.10");
    });

    it("returns multiple lines separated by newline for multiple games", () => {
        const games = [makeGame({ name: "Game A" }), makeGame({ name: "Game B" })];
        const lines = formatResult(games).split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain("Game A");
        expect(lines[1]).toContain("Game B");
    });

    it("returns empty string for empty games array", () => {
        expect(formatResult([])).toBe("");
    });

    it("uses empty string when region is null", () => {
        const result = formatResult([makeGame({ region: null })]);
        const parts = result.split("\t");
        expect(parts[8]).toBe("");
    });
});
