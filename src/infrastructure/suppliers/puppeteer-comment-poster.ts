import { getSuppliersSession } from "@/lib/puppeteer-browser.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";
import { PAGE_NAVIGATION_TIMEOUT, ELEMENT_WAIT_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

const INTROS = [
    "Hi! Interested in:",
    "Hey! I'm interested in:",
    "Hello! Looking for:",
    "Hi there! Interested in these:",
];

/**
 * Monta o texto do comentário com intro aleatória + lista de jogos + "Add me 🙂".
 * Exportada separadamente para facilitar testes sem Puppeteer.
 */
export function buildCommentText(games: ProfitableGameResult[]): string {
    const intro = INTROS[Math.floor(Math.random() * INTROS.length)];
    const lines = games
        .map((g) => `${g.name} --- ${g.tf2_price.toFixed(2).replace(".", ",")}x TF2`)
        .join("\n");
    return `${intro}\n\n${lines}\n\nAdd me 🙂`;
}

/**
 * Implementação de `CommentPoster` via Puppeteer.
 * Reutiliza o `page` original da sessão compartilhada de suppliers (mesmo padrão do bumper).
 * O cookie de autenticação é injetado pela factory antes de qualquer navegação.
 */
export class PuppeteerCommentPoster implements CommentPoster {
    async post(tradeUrl: string, games: ProfitableGameResult[]): Promise<void> {
        const { page } = await getSuppliersSession();

        await page.goto(tradeUrl, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });

        const title = await page.title();
        console.log(`🔍 [COMMENT] After goto — URL: ${page.url()} | Title: "${title}"`);

        const isLoggedIn = await page.$('a[href*="/login"]').then((el) => !el);
        if (!isLoggedIn) {
            throw new Error(`Not authenticated on SteamTrades (page: "${title}"). STEAMTRADES_SESSION may be expired.`);
        }

        const comment = buildCommentText(games);

        await page.waitForSelector('textarea[name="description"]', { timeout: ELEMENT_WAIT_TIMEOUT });
        await page.type('textarea[name="description"]', comment);
        await page.click(".btn_action.white.js_submit");
        await page.waitForNetworkIdle({ idleTime: 1000, timeout: ELEMENT_WAIT_TIMEOUT }).catch(() => {});

        console.log(`✅ [SUPPLIERS] Comment posted at ${tradeUrl}`);
    }
}
