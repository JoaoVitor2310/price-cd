import { describe, it, expect } from "vitest";
import { buildPageUrl, extractTopicsFromHtml } from "@/infrastructure/suppliers/puppeteer-trade-paginator.js";

describe("buildPageUrl", () => {
    it("filters listings by have=<searchTerm>", () => {
        expect(buildPageUrl(1, "tf2")).toBe("https://www.steamtrades.com/trades/search?have=tf2&page=1");
    });

    it("keeps the page number in sync across pages", () => {
        expect(buildPageUrl(19, "tf2")).toBe("https://www.steamtrades.com/trades/search?have=tf2&page=19");
    });

    it("url-encodes multi-word search terms", () => {
        expect(buildPageUrl(1, "Team Fortress 2 Key")).toBe(
            "https://www.steamtrades.com/trades/search?have=Team%20Fortress%202%20Key&page=1",
        );
    });
});

describe("extractTopicsFromHtml", () => {
    it("extracts code, full url and isClosed=false from each open topic link", () => {
        const html = `
            <div class="row_trade_name"><h2><a href="/trade/ABC12/some-slug">Title</a></h2></div>
            <div class="row_trade_name"><h2><a href="/trade/XYZ99/other-slug">Other</a></h2></div>
        `;

        expect(extractTopicsFromHtml(html)).toEqual([
            { code: "ABC12", url: "https://www.steamtrades.com/trade/ABC12/some-slug", isClosed: false },
            { code: "XYZ99", url: "https://www.steamtrades.com/trade/XYZ99/other-slug", isClosed: false },
        ]);
    });

    it("returns an empty array when there are no topics", () => {
        expect(extractTopicsFromHtml("<div>no topics here</div>")).toEqual([]);
    });

    it("marks a topic as closed when its h2 has the fa-lock icon", () => {
        // Amostra real do SteamTrades: cadeado (svg.fa-lock) no mesmo h2 do título quando a trade está fechada.
        const html = `
            <div class="row_trade_name">
                <h2><svg class="svg-inline--fa fa-lock fa-w-14 red" aria-hidden="true" focusable="false" data-prefix="fas" data-icon="lock" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" data-fa-i2svg=""><path fill="currentColor" d="M400 224h-24v-72C376 68.2 307.8 0 224 0S72 68.2 72 152v72H48c-26.5 0-48 21.5-48 48v192c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V272c0-26.5-21.5-48-48-48zm-104 0H152v-72c0-39.7 32.3-72 72-72s72 32.3 72 72v72z"></path></svg><a href="/trade/HAxEc/h-police-simulator-patrol-officers-w-1x-tf2-key">[H] Police Simulator: Patrol Officers [W] 1x TF2 Key</a></h2>
            </div>
        `;

        expect(extractTopicsFromHtml(html)).toEqual([
            {
                code: "HAxEc",
                url: "https://www.steamtrades.com/trade/HAxEc/h-police-simulator-patrol-officers-w-1x-tf2-key",
                isClosed: true,
            },
        ]);
    });
});
