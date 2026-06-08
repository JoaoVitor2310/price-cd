import * as cheerio from "cheerio";
import { initializeBrowser, cleanupBrowser } from "@/lib/puppeteer-browser.js";
import type { TopicScraper, TopicData } from "@/application/suppliers/ports/topic-scraper.port.js";
import { PAGE_NAVIGATION_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

const STEAM_ID_REGEX = /\/user\/([^\/?#]+)/i;

/**
 * Extrai os dados relevantes do HTML de um tópico individual.
 * Exportada separadamente para permitir testes unitários sem Puppeteer.
 */
function extractTopicData(html: string): TopicData {
    const $ = cheerio.load(html);

    const isInactive = $(".notification.yellow").length > 0;

    const authorName = $(".author_name").first().text().trim();

    const userHref = $('a[href*="/user/"]').first().attr("href") ?? "";
    const steamIdMatch = userHref.match(STEAM_ID_REGEX);
    const steamId = steamIdMatch?.[1] ?? "";

    const games = $(".have")
        .text()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Each comment lives inside .comment_outer → .comment_inner.
    // The timestamp is in <span data-timestamp="unix_seconds"> inside .action_list.
    const hasRecentComment = $(".comment_outer")
        .toArray()
        .some((el) => {
            const commentEl = $(el);
            const bodyText = commentEl.find(".comment_body").text();
            if (!bodyText.includes("Interested")) return false;

            const raw = commentEl.find("span[data-timestamp]").attr("data-timestamp");
            if (!raw) return true; // no timestamp found — assume recent to avoid re-commenting

            const commentDate = new Date(Number(raw) * 1000);
            return !Number.isNaN(commentDate.getTime()) && commentDate >= sixMonthsAgo;
        });

    return { authorName, steamId, games, isInactive, hasRecentComment };
}

/**
 * Implementação de `TopicScraper` via Puppeteer.
 * Abre e fecha um browser por chamada para evitar acúmulo de memória durante a paginação.
 */
export class PuppeteerTopicScraper implements TopicScraper {
    async scrape(url: string): Promise<TopicData> {
        const { browser, page } = await initializeBrowser();

        try {
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });
            const html = await page.content();
            return extractTopicData(html);
        } finally {
            await cleanupBrowser(browser);
        }
    }
}

export { extractTopicData };
