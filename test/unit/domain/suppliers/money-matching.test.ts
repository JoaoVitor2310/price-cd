import { describe, it, expect } from "vitest";
import { acceptedMoneyCurrencies, MONEY_SEARCH_TERMS } from "@/domain/suppliers/money-matching.js";

const accepted = (text: string) => [...acceptedMoneyCurrencies(text)].sort();

describe("MONEY_SEARCH_TERMS", () => {
    it("lists every money term the SteamTrades search needs", () => {
        expect(MONEY_SEARCH_TERMS).toEqual(["paypal", "pp", "euro", "dollar", "dolar", "usdt", "€", "$"]);
    });
});

describe("acceptedMoneyCurrencies", () => {
    describe("euro", () => {
        it.each(["Paypal", "PAYPAL", "pp", "PP", "Euro", "euros", "€", "10€", "€10"])(
            "reads %j as euro",
            (text) => {
                expect(accepted(text)).toEqual(["eur"]);
            },
        );
    });

    describe("dollar", () => {
        it.each(["Dollar", "dollars", "dolar", "Dolar", "$", "$5", "5$", "USDT", "usdt", "10 USDT"])(
            "reads %j as dollar",
            (text) => {
                expect(accepted(text)).toEqual(["usd"]);
            },
        );
    });

    describe("word boundaries", () => {
        it.each(["apple", "happy", "supply", "europe", "european", "dollarama", "usdtx", "musdt"])(
            "does not read %j as money",
            (text) => {
                expect(accepted(text)).toEqual([]);
            },
        );
    });

    describe("negation", () => {
        it.each([
            "no paypal",
            "No PayPal",
            "not accepting paypal",
            "no euros",
            "no $",
            "never pp",
            "I don't want dollars",
            "no usdt",
            "not accepting USDT",
        ])("does not accept %j", (text) => {
            expect(accepted(text)).toEqual([]);
        });

        it("keeps a method accepted when a later clause refuses a different one", () => {
            expect(accepted("paypal, no dollars")).toEqual(["eur"]);
        });

        it("does not let an earlier refusal of one method contaminate another", () => {
            expect(accepted("no paypal, euros ok")).toEqual(["eur"]);
        });

        it("does not accept a method followed by a bare refusal", () => {
            expect(accepted("paypal? not interested")).toEqual([]);
        });
    });

    describe("several methods in one line", () => {
        it("reports both currencies when the line mentions euro and dollar", () => {
            expect(accepted("€ or $")).toEqual(["eur", "usd"]);
        });

        it("reports only the currencies that are accepted", () => {
            expect(accepted("paypal, no dollars")).toEqual(["eur"]);
        });
    });

    it("does not read the bare abbreviation usd as money yet", () => {
        // Decisão consciente: cada termo de busca novo custa até 100 páginas de varredura.
        expect(accepted("usd")).toEqual([]);
    });

    it("reports dollar for USDT even next to PayPal", () => {
        expect(accepted("paypal, usdt")).toEqual(["eur", "usd"]);
    });

    it("returns nothing for a line with no money", () => {
        expect(accepted("CS2 skins")).toEqual([]);
        expect(accepted("TF2 keys")).toEqual([]);
    });
});
