import { describe, it, expect } from "vitest";
import { buildCommentText } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

function makeGame(overrides: Partial<ProfitableGameResult> = {}): ProfitableGameResult {
    return {
        name: "Half-Life",
        price_euro: 1.5,
        popularity: 100,
        region: null,
        tf2_price: 2.5,
        ...overrides,
    };
}

describe("buildCommentText", () => {
    it("includes each game with its tf2_price", () => {
        const games = [makeGame({ name: "Half-Life", tf2_price: 2.5 }), makeGame({ name: "Portal", tf2_price: 1.0 })];

        const text = buildCommentText(games, 3.5);

        expect(text).toContain("Half-Life --- 2.50x TF2");
        expect(text).toContain("Portal --- 1.00x TF2");
    });

    it("appends the total as the last line of the message", () => {
        const games = [makeGame({ tf2_price: 2.5 })];

        const text = buildCommentText(games, 2.5);
        const lines = text.trim().split("\n");

        expect(lines[lines.length - 1]).toBe("Total 2.50 TF2 Keys");
    });

    it("formats the total with two decimal places", () => {
        const text = buildCommentText([makeGame()], 12);

        expect(text).toContain("Total 12.00 TF2 Keys");
    });
});
