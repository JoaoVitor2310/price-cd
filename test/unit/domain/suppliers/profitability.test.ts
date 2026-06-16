import { describe, it, expect } from "vitest";
import { formatResult } from "@/domain/suppliers/profitability.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

const makeGame = (overrides: Partial<ProfitableGameResult> = {}): ProfitableGameResult => ({
    name: "Half-Life",
    priceEur: 4.50,
    popularity: 500,
    region: "global",
    tf2_price: 2.10,
    ...overrides,
});

describe("formatResult", () => {
    it("returns one line per game in TSV format", () => {
        const result = formatResult([makeGame()]);
        // \t{date}\t{price}\t\t\t\t\t{pop}\t{region}\t\t{name}
        //  [0]""  [1]date  [2]price [3..6]"" [7]pop  [8]region [9]"" [10]name
        const parts = result.split("\t");
        expect(parts[0]).toBe("");
        expect(parts[2]).toBe("4,50");
        expect(parts[7]).toBe("500");
        expect(parts[8]).toBe("global");
        expect(parts[10]).toBe("Half-Life");
    });

    it("uses comma as decimal separator for price", () => {
        const result = formatResult([makeGame({ priceEur: 3.99 })]);
        expect(result).toContain("3,99");
        expect(result).not.toContain("3.99");
    });

    it("returns multiple lines for multiple games", () => {
        const games = [makeGame({ name: "Game A" }), makeGame({ name: "Game B" })];
        const result = formatResult(games);
        expect(result.split("\n")).toHaveLength(2);
    });

    it("returns empty string for empty games array", () => {
        expect(formatResult([])).toBe("");
    });
});
