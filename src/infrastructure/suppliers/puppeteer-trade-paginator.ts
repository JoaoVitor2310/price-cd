import * as cheerio from "cheerio";
import { getSuppliersSession } from "@/lib/puppeteer-browser.js";
import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import { STEAMTRADES_BASE, PAGE_NAVIGATION_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

/**
 * `have=<searchTerm>` filtra, no próprio SteamTrades, listas cujo `.want` casa com o termo —
 * reduz bastante a varredura (de ~100 páginas totais para uma fração disso por termo), e por
 * consequência encolhe a janela em que um bump pode reordenar uma lista para fora do que já
 * foi coletado. Precisa ser chamado uma vez por variação em `TF2_SEARCH_TERMS` (ver
 * `src/domain/suppliers/tf2-key-matching.ts`) porque a busca do site é por substring exata.
 */
function buildPageUrl(page: number, searchTerm: string): string {
    return `${STEAMTRADES_BASE}/trades/search?have=${encodeURIComponent(searchTerm)}&page=${page}`;
}

/**
 * Parseia o HTML da página de listagem e retorna o code (ex.: `FjgPJ`), a URL completa e se
 * o tópico já está fechado — de cada tópico. `isClosed` vem do ícone de cadeado (`svg.fa-lock`)
 * que o SteamTrades renderiza no mesmo `h2` do título quando a negociação foi encerrada; é um
 * sinal diferente de `TopicData.isInactive` (que só existe dentro da página do próprio tópico,
 * via `.notification.yellow`) — este aqui é visível direto na listagem, sem precisar abrir nada.
 */
function extractTopicsFromHtml(html: string): Array<{ code: string; url: string; isClosed: boolean }> {
    const $ = cheerio.load(html);
    const topics: Array<{ code: string; url: string; isClosed: boolean }> = [];

    $(".row_trade_name").each((_, row) => {
        const $h2 = $(row).find("h2");
        const href = $h2.find("a").attr("href") ?? "";
        const match = href.match(/\/trade\/([^/]+)/);
        if (!match) return;

        topics.push({
            code: match[1],
            url: `${STEAMTRADES_BASE}${href}`,
            isClosed: $h2.find("svg.fa-lock").length > 0,
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
    async getTopicsFromPage(pageNumber: number, searchTerm: string): Promise<Array<{ code: string; url: string; isClosed: boolean }>> {
        const { page } = await getSuppliersSession();
        const url = buildPageUrl(pageNumber, searchTerm);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
        const html = await page.content();
        return extractTopicsFromHtml(html);
    }
}

export { extractTopicsFromHtml, buildPageUrl };
