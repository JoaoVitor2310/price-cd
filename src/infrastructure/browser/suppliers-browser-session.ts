import {
	cleanupBrowser,
	initializeBrowser,
	type SharedSession,
} from "@/lib/puppeteer-browser.js";

/**
 * A sessão de Chromium da Descoberta de Fornecedores, com dono explícito.
 *
 * Isolada da sessão do AllKeyShop de propósito: um processo do Chrome para a
 * execução inteira, compartilhado pelos três adapters (paginator, scraper,
 * poster). Eles abrem e fecham páginas; quem é dono do browser é esta classe.
 *
 * Mais simples que `SharedBrowserSession` porque não recicla por idade nem
 * serializa fila — a execução é uma só, do começo ao fim.
 */
export class SuppliersBrowserSession {
	private session: SharedSession | null = null;

	async get(): Promise<SharedSession> {
		if (!this.session) this.session = await initializeBrowser();
		return this.session;
	}

	/** Seguro de chamar mesmo se a sessão nunca foi aberta. */
	async cleanup(): Promise<void> {
		if (!this.session) return;

		const session = this.session;
		this.session = null;
		await cleanupBrowser(session.browser).catch(() => {});
	}
}
