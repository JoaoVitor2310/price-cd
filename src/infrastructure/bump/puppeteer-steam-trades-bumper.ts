import type { PageWithCursor } from "puppeteer-real-browser";
import type { BumpResult, SteamTradesBumper } from "@/application/bump/ports/steam-trades-bumper.port.js";
import type { Disposable } from "@/lib/dispose.js";
import { cleanupBrowser, initializeBrowser } from "@/lib/puppeteer-browser.js";

const TOPIC_URLS: string[] = [
	"https://www.steamtrades.com/trade/LgwHr/w-marchchoice-humble-multiplayer-madness-h-tf2keys-gems-crypto",
	"https://www.steamtrades.com/trade/HVWGM/h-tf2-gems-tods-w-xbox-game-pass-call-of-duty-black-ops-6-double-xp-minecraft-java",
	"https://www.steamtrades.com/trade/533Bx/h-bomb-rush-cyberfunkshift-happens-dungeon-and-more-want-tf2-tod-gems-as-payment",
];

function navigationTimeoutMs(): number {
	const n = Number(process.env.TIMEOUT);
	return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/**
 * Implementação do bump com sessão persistente de browser.
 *
 * Segue o mesmo padrão de FetchListTopic:
 * - `ensureSession()` faz lazy init na primeira execução e reutiliza nas seguintes.
 * - Se o Chrome morrer (crash/OOM), detecta via `browser.pages()` e recria a sessão.
 * - Cookie é injetado apenas ao abrir uma nova sessão — não a cada tick.
 * - `dispose()` implementa `Disposable` para que o scheduler chame cleanupBrowser no SIGTERM.
 */
export class PuppeteerSteamTradesBumper implements SteamTradesBumper, Disposable {
	private browser?: Awaited<ReturnType<typeof initializeBrowser>>["browser"];
	private page?: PageWithCursor;

	constructor(private readonly session: string) {}

	/**
	 * Retorna a page existente se o browser ainda está vivo, ou abre uma nova sessão.
	 * O cookie é injetado somente ao criar a sessão.
	 */
	private async ensureSession(): Promise<PageWithCursor> {
		if (this.browser && this.page) {
			try {
				await this.browser.pages(); // lança se o processo do Chrome morreu
				return this.page;
			} catch {
				// Browser morto — descarta e recria abaixo
				await cleanupBrowser(this.browser).catch(() => {});
				this.browser = undefined;
				this.page = undefined;
			}
		}

		const { browser, page } = await initializeBrowser();

		await page.browserContext().setCookie({
			name: "PHPSESSID",
			value: this.session,
			domain: "www.steamtrades.com",
			path: "/",
			httpOnly: true,
			secure: false,
		});

		this.browser = browser;
		this.page = page;

		return page;
	}

	async bumpUserTopics(_steamId: string): Promise<BumpResult[]> {
		const page = await this.ensureSession();
		const results: BumpResult[] = [];

		for (const url of TOPIC_URLS) {
			const code = extractCode(url);
			try {
				await page.goto(url, {
					waitUntil: "domcontentloaded",
					timeout: navigationTimeoutMs(),
				});

				await page.click("a.page_heading_btn_dropdown.green");
				await page.click(".js_trade_bump");
				await page.waitForNetworkIdle({ idleTime: 1000, timeout: 10_000 }).catch(() => {});

				results.push({ code, success: true, message: "bumped" });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`❌ [BUMP] Erro ao bumpar ${code}: ${message}`);
				results.push({ code, success: false, message });
			}
		}

		return results;
	}

	/**
	 * Encerra o browser persistente.
	 * Chamado pelo scheduler via `disposeIfPresent` no SIGTERM/SIGINT.
	 */
	async dispose(): Promise<void> {
		if (!this.browser) return;
		await cleanupBrowser(this.browser);
		this.browser = undefined;
		this.page = undefined;
	}
}

function extractCode(url: string): string {
	const match = url.match(/\/trade\/([^/]+)/);
	return match?.[1] ?? url;
}

export const createPuppeteerSteamTradesBumper = (): SteamTradesBumper | null => {
	const session = process.env.STEAMTRADES_SESSION?.trim();
	if (!session) {
		console.warn("⚠️ [BUMP] STEAMTRADES_SESSION não definido — bump desativado.");
		return null;
	}
	return new PuppeteerSteamTradesBumper(session);
};
