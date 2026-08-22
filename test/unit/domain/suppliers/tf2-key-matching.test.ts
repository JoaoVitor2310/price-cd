import { describe, it, expect } from "vitest";
import {
    TF2_SEARCH_TERMS,
    isWantingTf2Keys,
    refusesKeyCurrencyBroadly,
} from "@/domain/suppliers/tf2-key-matching.js";

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

    describe("negation separated from the phrase", () => {
        it("returns false for 'not interested in TF2 keys'", () => {
            expect(isWantingTf2Keys("not interested in TF2 keys")).toBe(false);
        });

        it("returns false for 'not interested in Team Fortress 2 keys'", () => {
            expect(isWantingTf2Keys("Not interested in Team Fortress 2 keys")).toBe(false);
        });

        it("returns false for a contracted negation", () => {
            expect(isWantingTf2Keys("I don't want TF2 keys")).toBe(false);
        });

        it("returns false for 'I don't want tf2' (lowercase, no 'keys')", () => {
            expect(isWantingTf2Keys("I don't want tf2")).toBe(false);
        });

        it("returns false for the apostrophe-less 'dont'", () => {
            expect(isWantingTf2Keys("I dont want tf2")).toBe(false);
        });

        it("returns false for 'no longer accepting TF2 keys'", () => {
            expect(isWantingTf2Keys("No longer accepting TF2 keys")).toBe(false);
        });

        it("returns false when a self-contained refusal trails the phrase", () => {
            expect(isWantingTf2Keys("TF2 keys? not interested")).toBe(false);
        });

        it("returns false when the trailing refusal is 'no thanks'", () => {
            expect(isWantingTf2Keys("Team Fortress 2 keys - no thanks")).toBe(false);
        });
    });

    describe("reluctance counts as refusal", () => {
        it("returns false for 'I rarely accept TF2 keys'", () => {
            expect(isWantingTf2Keys("I rarely accept TF2 keys")).toBe(false);
        });

        it("returns false for 'I seldom accept Team Fortress 2 keys'", () => {
            expect(isWantingTf2Keys("I seldom accept Team Fortress 2 keys")).toBe(false);
        });

        it("returns false for 'hardly ever take TF2'", () => {
            expect(isWantingTf2Keys("hardly ever take TF2")).toBe(false);
        });

        it("stays true when the reluctance is about another payment method", () => {
            expect(isWantingTf2Keys("I rarely accept paypal, TF2 keys always")).toBe(true);
        });
    });

    describe("negations that are not about TF2", () => {
        it("stays true when a refusal of another payment precedes TF2 in another clause", () => {
            expect(isWantingTf2Keys("no lowball offers, TF2 keys only")).toBe(true);
        });

        it("stays true when a refusal of another payment follows TF2 after a dash", () => {
            expect(isWantingTf2Keys("TF2 keys - no paypal")).toBe(true);
        });

        it("stays true when a refusal of another payment follows TF2 after a comma", () => {
            expect(isWantingTf2Keys("TF2 keys, not paypal")).toBe(true);
        });

        it("stays true when the refusal is in a previous sentence", () => {
            expect(isWantingTf2Keys("No gift links. Team Fortress 2 keys accepted")).toBe(true);
        });

        it("stays true when a trailing refusal names another payment method", () => {
            expect(isWantingTf2Keys("TF2 keys - not interested in gift links")).toBe(true);
        });

        it("stays true when a self-contained refusal comes before the TF2 mention", () => {
            expect(isWantingTf2Keys("Paypal? Not interested. TF2 keys only")).toBe(true);
        });
    });
});

describe("refusesKeyCurrencyBroadly", () => {
    it("matches the canonical phrasing seen in the wild", () => {
        expect(refusesKeyCurrencyBroadly("No CSGO Keys or similar")).toBe(true);
    });

    it("matches other key currencies with the same generalizer", () => {
        expect(refusesKeyCurrencyBroadly("no CS2 keys or similar")).toBe(true);
    });

    it("matches 'or anything similar'", () => {
        expect(refusesKeyCurrencyBroadly("No game keys or anything similar")).toBe(true);
    });

    it("matches 'or equivalent'", () => {
        expect(refusesKeyCurrencyBroadly("No CSGO key or equivalent")).toBe(true);
    });

    it("does not match a refusal of one currency without the generalizer", () => {
        expect(refusesKeyCurrencyBroadly("No CSGO Keys")).toBe(false);
    });

    it("does not match an acceptance phrased with 'or similar'", () => {
        expect(refusesKeyCurrencyBroadly("TF2 keys or similar")).toBe(false);
    });

    it("does not match a refusal that is not about keys", () => {
        expect(refusesKeyCurrencyBroadly("No lowball offers or similar")).toBe(false);
    });

    it("does not reach across a sentence boundary", () => {
        expect(refusesKeyCurrencyBroadly("No CSGO keys. Paypal or similar is fine")).toBe(false);
    });
});
