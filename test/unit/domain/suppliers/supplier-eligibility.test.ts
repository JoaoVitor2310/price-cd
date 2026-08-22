import { describe, it, expect } from "vitest";
import { acceptsTf2KeysFromUs } from "@/domain/suppliers/supplier-eligibility.js";

const topic = (wantLines: string[], haveLines: string[] = ["Half-Life"]) =>
    acceptsTf2KeysFromUs({ haveLines, wantLines });

describe("acceptsTf2KeysFromUs", () => {
    it("accepts a topic whose .want asks for TF2 keys", () => {
        expect(topic(["TF2 keys"])).toBe(true);
    });

    it("accepts when only one of several .want lines mentions TF2", () => {
        expect(topic(["Paypal", "TF2 keys", "Steam gifts"])).toBe(true);
    });

    it("refuses a topic that never mentions TF2", () => {
        expect(topic(["Paypal", "CS2 skins"])).toBe(false);
    });

    it("refuses a topic with no .want lines at all", () => {
        expect(topic([])).toBe(false);
    });

    describe("vetoes override an accepting line", () => {
        it("refuses when .have rejects resellers", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "No reseller offers"])).toBe(false);
        });

        it("refuses when .want rejects resellers", () => {
            expect(topic(["TF2 keys", "Not for resellers"])).toBe(false);
        });

        it("refuses when another .want line refuses key currency broadly", () => {
            expect(topic(["TF2 keys", "No CSGO Keys or similar"])).toBe(false);
        });

        it("refuses when the broad key refusal is written among the games", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "No CSGO Keys or similar"])).toBe(false);
        });

        it("refuses a topic whose only .want line is a broad key refusal", () => {
            expect(topic(["No CSGO Keys or similar"])).toBe(false);
        });
    });

    describe("near-misses that must not veto", () => {
        it("accepts when a single other key currency is refused without generalizing", () => {
            expect(topic(["TF2 keys", "No CSGO keys"])).toBe(true);
        });

        it("accepts when the topic is explicitly reseller friendly", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "Reseller friendly"])).toBe(true);
        });
    });
});
