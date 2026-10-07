import { Injectable } from "@nestjs/common";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { Offer, OfferCurrency } from "@/domain/suppliers/offer.js";
// Import de VALOR, não `import type`: a classe é o token de injeção, então
// precisa existir em runtime para o `design:paramtypes` do decorator
// registrá-la. Com `import type` o Nest injeta `undefined` — ver ADR 0004.
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import {
	ELEMENT_WAIT_TIMEOUT,
	PAGE_NAVIGATION_TIMEOUT,
} from "@/infrastructure/suppliers/steamtrades.constants.js";

const INTROS = [
	"Hi! Interested in:",
	"Hey! I'm interested in:",
	"Hello! Looking for:",
	"Hi there! Interested in these:",
	"Hey! I'd like to pick up:",
	"Hi! Looking to buy:",
	"Hello! I'm looking for:",
	"Hey! Would love to buy:",
];

const OUTROS_NOT_ADDED = [
	"Add me on Steam or message me directly if we're already friends 🙂",
	"Feel free to add me! If we're already friends, just send me a message on Steam.",
	"Add me if you're interested! Already friends? Just drop me a message on Steam chat.",
	"Send me a friend request or message me on Steam if we're already friends 🙂",
	"Add me on Steam to discuss — or if we're already friends, feel free to message me directly!",
];

function pick<T>(arr: T[]): T {
	return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Como cada Moeda de oferta aparece no texto. O TF2 mantém o formato que o fornecedor já conhece
 * ("1.50x TF2", "Total 3.00 TF2 Keys"); dinheiro leva o símbolo, no lado em que cada um se escreve.
 */
const AMOUNT_FORMAT: Record<
	OfferCurrency,
	{ line: (amount: number) => string; total: (amount: number) => string }
> = {
	tf2: {
		line: (amount) => `${amount.toFixed(2)}x TF2`,
		total: (amount) => `${amount.toFixed(2)} TF2 Keys`,
	},
	eur: {
		line: (amount) => `${amount.toFixed(2)}€`,
		total: (amount) => `${amount.toFixed(2)}€`,
	},
	usd: {
		line: (amount) => `$${amount.toFixed(2)}`,
		total: (amount) => `$${amount.toFixed(2)}`,
	},
};

/**
 * Monta o texto do comentário com intro e outro aleatórios + lista de jogos + total da Trade,
 * valores na Moeda de oferta da Lista. Exportada separadamente para facilitar testes sem Puppeteer.
 */
export function buildCommentText(offer: Offer): string {
	const format = AMOUNT_FORMAT[offer.currency];
	const lines = offer.lines
		.map((line) => `${line.name} --- ${format.line(line.amount)}`)
		.join("\n");
	return `${pick(INTROS)}\n\n${lines}\n\n${pick(OUTROS_NOT_ADDED)}\n\nTotal ${format.total(offer.total)}`;
}

/**
 * Implementação de `CommentPoster` via Puppeteer.
 * Reutiliza o `page` original da sessão compartilhada de suppliers (mesmo padrão do bumper).
 * O cookie de autenticação é injetado pela factory antes de qualquer navegação.
 */
@Injectable()
export class PuppeteerCommentPoster implements CommentPoster {
	/** A sessão vem do container: o `BrowserModule` é dono dela. */
	constructor(private readonly session: SuppliersBrowserSession) {}

	async post(tradeUrl: string, offer: Offer): Promise<void> {
		const { page } = await this.session.get();

		await page.goto(tradeUrl, {
			waitUntil: "domcontentloaded",
			timeout: PAGE_NAVIGATION_TIMEOUT,
		});

		const isLoggedIn = await page.$('a[href*="/login"]').then((el) => !el);
		if (!isLoggedIn) {
			const title = await page.title();
			throw new Error(
				`Not authenticated on SteamTrades (page: "${title}"). STEAMTRADES_SESSION may be expired.`,
			);
		}

		const comment = buildCommentText(offer);

		await page.waitForSelector('textarea[name="description"]', {
			timeout: ELEMENT_WAIT_TIMEOUT,
		});
		await page.type('textarea[name="description"]', comment);
		await page.click(".btn_action.white.js_submit");
		await page
			.waitForNetworkIdle({ idleTime: 1000, timeout: ELEMENT_WAIT_TIMEOUT })
			.catch(() => {});

		console.log(`✅ [SUPPLIERS] Comment posted at ${tradeUrl}`);
	}
}
