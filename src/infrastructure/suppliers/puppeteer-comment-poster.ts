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
 * Injeta o cookie `PHPSESSID` antes de navegar para autenticar no SteamTrades
 * sem precisar de um fluxo de login interativo a cada execução.
 *
 * Reutiliza o browser da sessão compartilhada de suppliers — o cookie é definido
 * no contexto do browser e persiste para todas as páginas da mesma sessão.
 */
export class PuppeteerCommentPoster implements CommentPoster {
    constructor(private readonly phpSessionId: string) {}

    async post(tradeUrl: string, games: ProfitableGameResult[]): Promise<void> {
        const { browser } = await getSuppliersSession();
        const page = await browser.newPage();

        try {
            await page.browserContext().setCookie({
                name: "PHPSESSID",
                value: this.phpSessionId,
                domain: "www.steamtrades.com",
                path: "/",
                httpOnly: true,
                secure: false,
            });

            await page.goto(tradeUrl, { waitUntil: "domcontentloaded", timeout: PAGE_NAVIGATION_TIMEOUT });

            const comment = buildCommentText(games);

            await page.waitForSelector('textarea[name="description"]', { timeout: ELEMENT_WAIT_TIMEOUT });
            await page.type('textarea[name="description"]', comment);
            await page.click(".btn_action.white.js_submit");
            await page.waitForNetworkIdle({ idleTime: 1000, timeout: ELEMENT_WAIT_TIMEOUT }).catch(() => {});

            console.log(`✅ [SUPPLIERS] Comment posted at ${tradeUrl}`);
        } finally {
            await page.close();
        }
    }
}
