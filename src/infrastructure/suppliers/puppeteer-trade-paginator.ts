import * as cheerio from "cheerio";
import { initializeBrowser, cleanupBrowser } from "@/lib/puppeteer-browser.js";
import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import { STEAMTRADES_BASE, PAGE_NAVIGATION_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

function buildPageUrl(page: number): string {
    return `${STEAMTRADES_BASE}/trades/search?page=${page}`;
}

/** Parseia o HTML da página de listagem e retorna o code (ex.: `FjgPJ`) e a URL completa de cada tópico. */
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

/**
 * Implementação de `TradePaginator` via Puppeteer.
 * Abre e fecha um browser por chamada — adequado ao uso sequencial do use case.
 */
export class PuppeteerTradePaginator implements TradePaginator {
    async getTopicsFromPage(page: number): Promise<Array<{ code: string; url: string }>> {
        const { browser, page: browserPage } = await initializeBrowser();

        try {
            const url = buildPageUrl(page);
            await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
            const html = await browserPage.content();
            const topics = extractTopicsFromHtml(html);
            console.log(`[PAGINATOR] Page ${page} — ${topics.length} topics found:`, topics);
            return topics;
        } finally {
            await cleanupBrowser(browser);
        }
    }
}

export { extractTopicsFromHtml };
