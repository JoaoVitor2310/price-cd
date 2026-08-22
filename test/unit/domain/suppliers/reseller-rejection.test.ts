import { describe, it, expect } from "vitest";
import { rejectsResellers } from "@/domain/suppliers/reseller-rejection.js";

describe("rejectsResellers", () => {
    it("matches the canonical phrasing seen in the wild", () => {
        expect(rejectsResellers("No reseller offers")).toBe(true);
    });

    it("matches case-insensitively", () => {
        expect(rejectsResellers("no RESELLER offers")).toBe(true);
    });

    it("matches the plural form", () => {
        expect(rejectsResellers("No resellers")).toBe(true);
    });

    it("matches with words between the negation and 'resellers'", () => {
        expect(rejectsResellers("No offers from resellers please")).toBe(true);
    });

    it("matches 'not for resellers'", () => {
        expect(rejectsResellers("Not for resellers")).toBe(true);
    });

    it("matches 'not interested in resellers'", () => {
        expect(rejectsResellers("Not interested in resellers")).toBe(true);
    });

    it("matches when the negation trails the noun", () => {
        expect(rejectsResellers("Resellers are not welcome")).toBe(true);
    });

    it("matches the gerund form", () => {
        expect(rejectsResellers("No reselling")).toBe(true);
    });

    it("returns false for a plain game line", () => {
        expect(rejectsResellers("Half-Life 2")).toBe(false);
    });

    it("returns false for a plain currency line", () => {
        expect(rejectsResellers("TF2 keys only")).toBe(false);
    });

    it("returns false when 'reseller' appears without a negation", () => {
        expect(rejectsResellers("Reseller friendly")).toBe(false);
    });

    it("returns false when a negation is too far from 'reseller' to be about it", () => {
        expect(rejectsResellers("No lowball offers, keys only, I trade with any reseller")).toBe(false);
    });
});
