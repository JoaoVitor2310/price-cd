import * as cheerio from "cheerio";
import { getSuppliersSession } from "@/lib/puppeteer-browser.js";
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
 * Reutiliza o browser da sessão compartilhada de suppliers — abre e fecha apenas
 * uma `page` por chamada, sem inicializar um novo processo Chrome a cada paginação.
 */
export class PuppeteerTradePaginator implements TradePaginator {
    async getTopicsFromPage(pageNumber: number): Promise<Array<{ code: string; url: string }>> {
        const { page } = await getSuppliersSession();
        const url = buildPageUrl(pageNumber);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
        const html = await page.content();
        return extractTopicsFromHtml(html);
    }
}

export { extractTopicsFromHtml };
