import * as cheerio from "cheerio";
import { ListTopic } from "@/domain/lists/list-topic.js";
import type { ListTopicFetcher } from "@/application/lists/ports/list-run.ports.js";
import { cleanupBrowser, initializeBrowser } from "@/lib/puppeteer-browser.js";

/**
 * Implementação de busca de jogos a partir de uma lista de tópicos.
 */
export class FetchListTopic implements ListTopicFetcher {
	async fetchUserLists(idSteam: string): Promise<ListTopic[]> {
		const { browser, page } = await initializeBrowser();
		const response = await page.goto(`https://www.steamtrades.com/trades/search?user=${idSteam}`, {
			waitUntil: "domcontentloaded",
			timeout: 2000,
		});

		const status = response?.status();
		console.log("status", status);

		if (status !== 200) {
			await cleanupBrowser(browser);
			// Definir retorno de erro
			// return new ListTopic(topicRef, "inactive", []);
		}

		const listTopics: ListTopic[] = [];

		const html = await page.content();
		const $ = cheerio.load(html);

		// Buscar todos h2 dentro de div.row_trade_name
		const h2s = $("div.row_trade_name h2");
		console.log("h2s");
		console.log(h2s);
		for (const h2 of h2s) {
			// Se não tiver svg.svg-inline--fa.fa-lock.fa-w-14 red
			const inactive = $(h2).find("svg.svg-inline--fa.fa-lock.fa-w-14.red").length > 0;
			if (inactive) continue;

			// Link é o <a> dentro de h2
			const link = $(h2).find("a").attr("href");
			if (!link) continue;

			listTopics.push(new ListTopic('https://www.steamtrades.com/' + link, "active", []));
		}

		await cleanupBrowser(browser);
		return listTopics;
	}

	async fetchList(topicRef: string): Promise<ListTopic> {
		const gameNames: string[] = [];
		const { browser, page } = await initializeBrowser();

		const response = await page.goto(topicRef, {
			waitUntil: "domcontentloaded",
			timeout: 2000,
		});

		const status = response?.status();

		if (status !== 200) {
			await cleanupBrowser(browser);
			return new ListTopic(topicRef, "inactive", []);
		}

		const html = await page.content();
		const $ = cheerio.load(html);

		const inactive = $("div.notification.yellow").length > 0;
		if (inactive) {
			await cleanupBrowser(browser);
			return new ListTopic(topicRef, "inactive", []);
		}

		// Pegar conteúdo da div.have
		const gamesText = $("div.have").text();

		// Cada linha é um jogo
		gamesText.split("\n").forEach((game) => {
			gameNames.push(game.trim());
		});

		await cleanupBrowser(browser);

		// Fallback: se nada foi capturado, tente outro seletor ou deixe vazio
		return new ListTopic(topicRef, "active", gameNames);
	}
}

export const fetchListTopic = (): ListTopicFetcher => new FetchListTopic();
