import { getSuppliersSession } from "@/lib/puppeteer-browser.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";
import { PAGE_NAVIGATION_TIMEOUT, ELEMENT_WAIT_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

const INTROS = [
    "Hi! Interested in:",
    "Hey! I'm interested in:",
    "Hello! Looking for:",
    "Hi there! Interested in these:",
    "Hey! I'd like to pick up:",
    "Hi! Looking to buy:",
    "Hello! I'm looking for:",
    "Hey there! Would love to grab:",
];

const OUTROS_NOT_ADDED = [
    "Add me on Steam or message me directly if we're already friends 🙂",
    "Feel free to add me! If we're already friends, just send me a message on Steam.",
    "Add me if you're interested! Already friends? Just drop me a message on Steam chat.",
    "Send me a friend request or message me on Steam if we're already connected 🙂",
    "Add me on Steam to discuss — or if we're already friends, feel free to message me directly!",
];

function pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Monta o texto do comentário com intro e outro aleatórios + lista de jogos.
 * Exportada separadamente para facilitar testes sem Puppeteer.
 */
export function buildCommentText(games: ProfitableGameResult[]): string {
    const lines = games
        .map((g) => `${g.name} --- ${g.tf2_price.toFixed(2)}x TF2`)
        .join("\n");
    return `${pick(INTROS)}\n\n${lines}\n\n${pick(OUTROS_NOT_ADDED)}`;
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

        const isLoggedIn = await page.$('a[href*="/login"]').then((el) => !el);
        if (!isLoggedIn) {
            const title = await page.title();
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
