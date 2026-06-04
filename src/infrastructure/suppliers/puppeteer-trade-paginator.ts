import * as cheerio from "cheerio";
import { initializeBrowser, cleanupBrowser } from "@/lib/puppeteer-browser.js";
import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";

const STEAMTRADES_BASE = "https://www.steamtrades.com";

function buildPageUrl(page: number): string {
    if (page === 1) return `${STEAMTRADES_BASE}/`;
    return `${STEAMTRADES_BASE}/trades/search?page=${page}`;
}

function extractTopicsFromHtml(html: string): Array<{ code: string; url: string }> {
    const $ = cheerio.load(html);
    const topics: Array<{ code: string; url: string }> = [];

    $(".row_trade_name h2 a").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        const match = href.match(/\/trade\/([^/]+)/);
        if (!match) return;
        topics.push({
            code: match[1],
            url: `${STEAMTRADES_BASE}${href}`,
        });
    });

    return topics;
}

export class PuppeteerTradePaginator implements TradePaginator {
    async getTopicsFromPage(page: number): Promise<Array<{ code: string; url: string }>> {
        const { browser, page: browserPage } = await initializeBrowser();

        try {
            const url = buildPageUrl(page);
            await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
            const html = await browserPage.content();
            return extractTopicsFromHtml(html);
        } finally {
            await cleanupBrowser(browser);
        }
    }
}

export { extractTopicsFromHtml };
