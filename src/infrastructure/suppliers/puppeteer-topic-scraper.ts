import { Injectable } from "@nestjs/common";
import * as cheerio from "cheerio";
import type {
	TopicData,
	TopicScraper,
} from "@/application/suppliers/ports/topic-scraper.port.js";
import { HaveListing } from "@/domain/lists/have-listing.js";
import { offerCurrencyFor } from "@/domain/suppliers/supplier-eligibility.js";
// Import de VALOR, não `import type`: a classe é o token de injeção, então
// precisa existir em runtime para o `design:paramtypes` do decorator
// registrá-la. Com `import type` o Nest injeta `undefined` — ver ADR 0004.
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import { PAGE_NAVIGATION_TIMEOUT } from "@/infrastructure/suppliers/steamtrades.constants.js";

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

	const haveText = $(".have").text();
	const wantLines = toLines($(".want").text());

	// Os jogos a precificar excluem plataformas não suportadas, mas o veto de
	// revendedor precisa de TODAS as linhas: o recado do dono costuma estar no
	// meio da lista, inclusive dentro de uma seção descartada.
	const games = HaveListing.parse(haveText).priceableGames;
	const offerCurrency = offerCurrencyFor({
		haveLines: toLines(haveText),
		wantLines,
	});

	return { authorName, steamId, games, isInactive, offerCurrency };
}

/**
 * Implementação de `TopicScraper` via Puppeteer.
 * Faz uma única navegação por tópico — extrai metadados (autor, jogos, status).
 * A decisão de comentar (histórico + mudança de jogos) é delegada ao Sistema Estoque via `ProfitabilityChecker`.
 */
@Injectable()
export class PuppeteerTopicScraper implements TopicScraper {
	/** A sessão vem do container: o `BrowserModule` é dono dela. */
	constructor(private readonly session: SuppliersBrowserSession) {}

	async scrape(url: string): Promise<TopicData> {
		const { page } = await this.session.get();
		await page.goto(url, {
			waitUntil: "domcontentloaded",
			timeout: PAGE_NAVIGATION_TIMEOUT,
		});
		return extractTopicData(await page.content());
	}
}
