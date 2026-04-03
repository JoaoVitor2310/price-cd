import * as cheerio from "cheerio";
import type { PageWithCursor } from "puppeteer-real-browser";
import type { ListTopicFetcher } from "@/application/lists/ports/list-run.ports.js";
import { ListTopic } from "@/domain/lists/list-topic.js";
import { delay } from "@/helpers/utils.js";
import { cleanupBrowser, initializeBrowser } from "@/lib/puppeteer-browser.js";

/** Mesmo TIMEOUT do browser; 2s fixo estourava na VPS com listas concorrentes. */
function navigationTimeoutMs(): number {
	const n = Number(process.env.TIMEOUT);
	return Number.isFinite(n) && n > 0 ? n : 30_000;
}

/**
 * Fila global: só uma navegação steamtrades.com por vez (vários jobs em paralelo
 * compartilhavam o site e tomavam rate limit na busca por usuário + tópicos).
 */
let steamTradesGate: Promise<unknown> = Promise.resolve();

function runSerializedOnSteamTrades<T>(fn: () => Promise<T>): Promise<T> {
	const run = steamTradesGate.then(() => fn());
	steamTradesGate = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

/** Pausa opcional após cada página (ms). Ex.: STEAMTRADES_PAGE_DELAY_MS=1200 */
async function pauseAfterSteamTradesPage(): Promise<void> {
	const ms = Number(process.env.STEAMTRADES_PAGE_DELAY_MS);
	if (Number.isFinite(ms) && ms > 0) await delay(ms);
}

/**
 * Implementação de busca de jogos a partir de uma lista de tópicos.
 */
export class FetchListTopic implements ListTopicFetcher {
	private browser?: Awaited<ReturnType<typeof initializeBrowser>>["browser"];
	private page?: PageWithCursor;

	private async ensureBrowser(): Promise<{
		browser: Awaited<ReturnType<typeof initializeBrowser>>["browser"];
		page: PageWithCursor;
	}> {
		if (this.browser && this.page)
			return { browser: this.browser, page: this.page };

		const { browser, page } = await initializeBrowser();
		this.browser = browser;
		this.page = page;
		return { browser, page };
	}

	/**
	 * Fecha o browser reutilizado (se houver).
	 * O `RunListsUseCase` chama isso no `finally` via type guard.
	 */
	async dispose(): Promise<void> {
		if (!this.browser) return;
		await cleanupBrowser(this.browser);
		this.browser = undefined;
		this.page = undefined;
	}

	async fetchUserLists(idSteam: string): Promise<ListTopic[]> {
		return runSerializedOnSteamTrades(async () => {
			const { page } = await this.ensureBrowser();
			const response = await page.goto(
				`https://www.steamtrades.com/trades/search?user=${idSteam}`,
				{
					waitUntil: "domcontentloaded",
					timeout: navigationTimeoutMs(),
				},
			);

			const status = response?.status();

			if (status !== 200) {
				await pauseAfterSteamTradesPage();
				return [];
			}

			const listTopics: ListTopic[] = [];

			const html = await page.content();
			const $ = cheerio.load(html);

			// Buscar todos h2 dentro de div.row_trade_name
			const h2s = $("div.row_trade_name h2");
			for (const h2 of h2s) {
				// Se não tiver svg.svg-inline--fa.fa-lock.fa-w-14 red
				const inactive =
					$(h2).find("svg.svg-inline--fa.fa-lock.fa-w-14.red").length > 0;
				if (inactive) continue;

				// Link é o <a> dentro de h2
				const link = $(h2).find("a").attr("href");
				if (!link) continue;

				listTopics.push(
					new ListTopic("https://www.steamtrades.com/" + link, "active", []),
				);
			}

			await pauseAfterSteamTradesPage();
			return listTopics;
		});
	}

	async fetchList(topicRef: string): Promise<ListTopic> {
		return runSerializedOnSteamTrades(async () => {
			const gameNames: string[] = [];
			const { page } = await this.ensureBrowser();

			const response = await page.goto(topicRef, {
				waitUntil: "domcontentloaded",
				timeout: navigationTimeoutMs(),
			});

			const status = response?.status();

			if (status !== 200) {
				await pauseAfterSteamTradesPage();
				return new ListTopic(topicRef, "inactive", []);
			}

			const html = await page.content();
			const $ = cheerio.load(html);

			const inactive = $("div.notification.yellow").length > 0;
			if (inactive) {
				await pauseAfterSteamTradesPage();
				return new ListTopic(topicRef, "inactive", []);
			}

			// Pegar conteúdo da div.have
			const gamesText = $("div.have").text();

			// Cada linha é um jogo
			gamesText.split("\n").forEach((game) => {
				gameNames.push(game.trim());
			});

			await pauseAfterSteamTradesPage();
			// Fallback: se nada foi capturado, tente outro seletor ou deixe vazio
			return new ListTopic(topicRef, "active", gameNames);
		});
	}
}

export const fetchListTopic = (): ListTopicFetcher => new FetchListTopic();
