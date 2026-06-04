import { initializeBrowser, cleanupBrowser } from "@/lib/puppeteer-browser.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

const INTROS = [
    "Hi! Interested in:",
    "Hey! I'm interested in:",
    "Hello! Looking for:",
    "Hi there! Interested in these:",
];

export function buildCommentText(games: ProfitableGameResult[]): string {
    const intro = INTROS[Math.floor(Math.random() * INTROS.length)];
    const lines = games
        .map((g) => `${g.name} --- ${g.tf2_price.toFixed(2).replace(".", ",")}x TF2`)
        .join("\n");
    return `${intro}\n\n${lines}\n\nAdd me 🙂`;
}

export class PuppeteerCommentPoster implements CommentPoster {
    constructor(private readonly phpSessionId: string) {}

    async post(tradeUrl: string, games: ProfitableGameResult[]): Promise<void> {
        const { browser, page } = await initializeBrowser();

        try {
            await page.browserContext().setCookie({
                name: "PHPSESSID",
                value: this.phpSessionId,
                domain: "www.steamtrades.com",
                path: "/",
                httpOnly: true,
                secure: false,
            });

            await page.goto(tradeUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

            const comment = buildCommentText(games);

            await page.waitForSelector('textarea[name="description"]', { timeout: 10000 });
            await page.type('textarea[name="description"]', comment);
            await page.click(".btn_action.white.js_submit");
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {});

            console.log(`✅ [SUPPLIERS] Comentário postado em ${tradeUrl}`);
        } finally {
            await cleanupBrowser(browser);
        }
    }
}
