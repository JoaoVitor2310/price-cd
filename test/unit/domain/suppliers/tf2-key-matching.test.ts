import { describe, it, expect } from "vitest";
import { TF2_SEARCH_TERMS, isWantingTf2Keys } from "@/domain/suppliers/tf2-key-matching.js";

describe("TF2_SEARCH_TERMS", () => {
    it("includes both the abbreviation and the spelled-out phrase", () => {
        expect(TF2_SEARCH_TERMS).toEqual(["TF2", "Team Fortress 2"]);
    });
});

describe("isWantingTf2Keys", () => {
    it("matches the TF2 abbreviation", () => {
        expect(isWantingTf2Keys("TF2 keys")).toBe(true);
    });

    it("matches the TF2 abbreviation case-insensitively", () => {
        expect(isWantingTf2Keys("tf2")).toBe(true);
    });

    it("matches the spelled-out phrase with 'Key' even without the abbreviation", () => {
        expect(isWantingTf2Keys("Looking for Team Fortress 2 Key offers")).toBe(true);
    });

    it("matches the spelled-out phrase without 'Key'", () => {
        expect(isWantingTf2Keys("Looking for Team Fortress 2 offers")).toBe(true);
    });

    it("returns false when neither phrasing is present", () => {
        expect(isWantingTf2Keys("CS2 skins\nDota 2 items")).toBe(false);
    });

    it("returns false when negated with 'no TF2'", () => {
        expect(isWantingTf2Keys("no TF2")).toBe(false);
    });

    it("returns false when negated with 'no Team Fortress 2 Key'", () => {
        expect(isWantingTf2Keys("no Team Fortress 2 Key")).toBe(false);
    });
});
