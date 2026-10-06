import { describe, it, expect } from "vitest";
import { buildCommentText } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import type { Offer } from "@/domain/suppliers/offer.js";

function makeOffer(overrides: Partial<Offer> = {}): Offer {
    return {
        currency: "tf2",
        lines: [{ name: "Half-Life", amount: 2.5 }],
        total: 2.5,
        ...overrides,
    };
}

describe("buildCommentText", () => {
    describe("in TF2 keys", () => {
        it("includes each game with its amount", () => {
            const offer = makeOffer({
                lines: [
                    { name: "Half-Life", amount: 2.5 },
                    { name: "Portal", amount: 1.0 },
                ],
                total: 3.5,
            });

            const text = buildCommentText(offer);

            expect(text).toContain("Half-Life --- 2.50x TF2");
            expect(text).toContain("Portal --- 1.00x TF2");
        });

        it("appends the total as the last line of the message", () => {
            const lines = buildCommentText(makeOffer()).trim().split("\n");

            expect(lines[lines.length - 1]).toBe("Total 2.50 TF2 Keys");
        });

        it("formats the total with two decimal places", () => {
            expect(buildCommentText(makeOffer({ total: 12 }))).toContain("Total 12.00 TF2 Keys");
        });
    });

    describe("in euros", () => {
        const offer = makeOffer({
            currency: "eur",
            lines: [
                { name: "Half-Life", amount: 1.2 },
                { name: "Portal", amount: 0.8 },
            ],
            total: 2,
        });

        it("writes each game with the euro sign", () => {
            const text = buildCommentText(offer);

            expect(text).toContain("Half-Life --- 1.20€");
            expect(text).toContain("Portal --- 0.80€");
        });

        it("writes the total in euros as the last line", () => {
            const lines = buildCommentText(offer).trim().split("\n");

            expect(lines[lines.length - 1]).toBe("Total 2.00€");
        });

        it("never mentions TF2", () => {
            expect(buildCommentText(offer)).not.toContain("TF2");
        });
    });

    describe("in dollars", () => {
        const offer = makeOffer({
            currency: "usd",
            lines: [{ name: "Half-Life", amount: 1.3 }],
            total: 1.3,
        });

        it("writes each game with the dollar sign before the amount", () => {
            expect(buildCommentText(offer)).toContain("Half-Life --- $1.30");
        });

        it("writes the total in dollars as the last line", () => {
            const lines = buildCommentText(offer).trim().split("\n");

            expect(lines[lines.length - 1]).toBe("Total $1.30");
        });

        it("never mentions TF2", () => {
            expect(buildCommentText(offer)).not.toContain("TF2");
        });
    });
});
