import * as cheerio from "cheerio";
import { getSuppliersSession } from "@/lib/puppeteer-browser.js";
import type { TopicScraper, TopicData } from "@/application/suppliers/ports/topic-scraper.port.js";
import { PAGE_NAVIGATION_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";
import { acceptsTf2KeysFromUs } from "@/domain/suppliers/supplier-eligibility.js";

const STEAM_ID_REGEX = /\/user\/(\d+)/i;

const toLines = (text: string): string[] =>
    text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

/**
 * Extrai os dados do tópico a partir do HTML da página principal.
 * Exportada separadamente para permitir testes unitários sem Puppeteer.
 */
export function extractTopicData(html: string): TopicData {
    const $ = cheerio.load(html);

    const isInactive = $(".notification.yellow").length > 0;

    const authorLink = $(".comment_inner").first().find("a.author_name");
    const authorName = authorLink.text().trim();
    const steamIdMatch = (authorLink.attr("href") ?? "").match(STEAM_ID_REGEX);
    const steamId = steamIdMatch?.[1] ?? "";

    const games = toLines($(".have").text());
    const wantLines = toLines($(".want").text());

    const wantsTf2Key = acceptsTf2KeysFromUs({ haveLines: games, wantLines });

    return { authorName, steamId, games, isInactive, wantsTf2Key };
}

/**
 * Implementação de `TopicScraper` via Puppeteer.
 * Faz uma única navegação por tópico — extrai metadados (autor, jogos, status).
 * A decisão de comentar (histórico + mudança de jogos) é delegada ao Sistema Estoque via `ProfitabilityChecker`.
 */
export class PuppeteerTopicScraper implements TopicScraper {
    async scrape(url: string): Promise<TopicData> {
        const { page } = await getSuppliersSession();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
        return extractTopicData(await page.content());
    }
}
