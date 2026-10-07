import { describe, it, expect } from "vitest";
import {
    offerCurrencyFor,
    SUPPLIER_SEARCH_TERMS,
} from "@/domain/suppliers/supplier-eligibility.js";
import { MONEY_SEARCH_TERMS } from "@/domain/suppliers/money-matching.js";
import { TF2_SEARCH_TERMS } from "@/domain/suppliers/tf2-key-matching.js";

const topic = (wantLines: string[], haveLines: string[] = ["Half-Life"]) =>
    offerCurrencyFor({ haveLines, wantLines });

describe("SUPPLIER_SEARCH_TERMS", () => {
    it("searches every TF2 term and every money term", () => {
        expect(SUPPLIER_SEARCH_TERMS).toEqual([...TF2_SEARCH_TERMS, ...MONEY_SEARCH_TERMS]);
    });

    it("covers each term the business asked for", () => {
        for (const term of ["paypal", "pp", "euro", "dolar", "usdt", "€", "$"]) {
            expect(SUPPLIER_SEARCH_TERMS).toContain(term);
        }
    });

    it("has no duplicate term, so no page is scanned twice for the same search", () => {
        expect(new Set(SUPPLIER_SEARCH_TERMS).size).toBe(SUPPLIER_SEARCH_TERMS.length);
    });
});

describe("offerCurrencyFor", () => {
    describe("TF2 keys", () => {
        it("offers in TF2 when .want asks for TF2 keys", () => {
            expect(topic(["TF2 keys"])).toBe("tf2");
        });

        it("offers in TF2 when only one of several .want lines mentions TF2", () => {
            expect(topic(["Steam gifts", "TF2 keys", "CS2 skins"])).toBe("tf2");
        });

        it("prefers TF2 over money when the list accepts both", () => {
            expect(topic(["Paypal", "TF2 keys"])).toBe("tf2");
            expect(topic(["TF2 keys", "$"])).toBe("tf2");
        });

        it("still offers in TF2 when another payment method is refused alongside", () => {
            expect(topic(["TF2 keys - no paypal"])).toBe("tf2");
        });
    });

    describe("money", () => {
        it("offers in euros when the list accepts PayPal", () => {
            expect(topic(["Paypal"])).toBe("eur");
        });

        it("offers in euros when the list accepts pp", () => {
            expect(topic(["pp only"])).toBe("eur");
        });

        it("offers in euros when the list accepts euros", () => {
            expect(topic(["Euro"])).toBe("eur");
            expect(topic(["10€"])).toBe("eur");
        });

        it("offers in dollars when the list accepts dollars", () => {
            expect(topic(["Dollar"])).toBe("usd");
            expect(topic(["dolar"])).toBe("usd");
            expect(topic(["USDT"])).toBe("usd");
            expect(topic(["$5 per game"])).toBe("usd");
        });

        it("prefers dollars over euros when the list mentions both", () => {
            expect(topic(["Paypal", "$"])).toBe("usd");
            expect(topic(["Paypal $"])).toBe("usd");
            expect(topic(["Paypal, USDT"])).toBe("usd");
            expect(topic(["€ or $"])).toBe("usd");
        });

        it("does not read a refused payment method as accepted", () => {
            expect(topic(["no paypal"])).toBeNull();
            expect(topic(["not accepting euros"])).toBeNull();
        });

        it("keeps the money a list accepts when it refuses another one", () => {
            expect(topic(["Paypal, no dollars"])).toBe("eur");
        });

        it("ignores money mentioned among the games (.have)", () => {
            expect(topic(["CS2 skins"], ["Half-Life", "Paypal"])).toBeNull();
        });
    });

    describe("nothing we offer", () => {
        it("refuses a topic that mentions no payment method we offer", () => {
            expect(topic(["CS2 skins", "Steam gifts"])).toBeNull();
        });

        it("refuses a topic with no .want lines at all", () => {
            expect(topic([])).toBeNull();
        });
    });

    describe("vetoes", () => {
        it("refuses when .have rejects resellers", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "No reseller offers"])).toBeNull();
        });

        it("refuses when .want rejects resellers", () => {
            expect(topic(["TF2 keys", "Not for resellers"])).toBeNull();
        });

        it("refuses a money list that rejects resellers", () => {
            expect(topic(["Paypal"], ["Half-Life", "No reseller offers"])).toBeNull();
            expect(topic(["Paypal", "$", "Not for resellers"])).toBeNull();
        });

        it("refuses TF2 when another .want line refuses key currency broadly", () => {
            expect(topic(["TF2 keys", "No CSGO Keys or similar"])).toBeNull();
        });

        it("refuses TF2 when the broad key refusal is written among the games", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "No CSGO Keys or similar"])).toBeNull();
        });

        it("refuses a topic whose only .want line is a broad key refusal", () => {
            expect(topic(["No CSGO Keys or similar"])).toBeNull();
        });

        it("falls back to money when it refuses keys broadly but accepts PayPal", () => {
            // Recusar moeda-key em bloco inclui a TF2 Key, mas não inclui dinheiro.
            expect(topic(["TF2 keys", "No CSGO Keys or similar", "Paypal"])).toBe("eur");
        });
    });

    describe("near-misses that must not veto", () => {
        it("offers in TF2 when a single other key currency is refused without generalizing", () => {
            expect(topic(["TF2 keys", "No CSGO keys"])).toBe("tf2");
        });

        it("offers in TF2 when the topic is explicitly reseller friendly", () => {
            expect(topic(["TF2 keys"], ["Half-Life", "Reseller friendly"])).toBe("tf2");
        });
    });
});
