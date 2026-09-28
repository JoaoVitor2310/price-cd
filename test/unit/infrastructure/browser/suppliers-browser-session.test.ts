import { beforeEach, describe, expect, it, vi } from "vitest";

const { initializeBrowser, cleanupBrowser } = vi.hoisted(() => ({
	initializeBrowser: vi.fn(),
	cleanupBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/puppeteer-browser.js", () => ({
	initializeBrowser,
	cleanupBrowser,
}));

const { SuppliersBrowserSession } = await import(
	"@/infrastructure/browser/suppliers-browser-session.js"
);

const makeSession = () => ({ browser: { id: Math.random() }, page: {} });

/**
 * A sessão da Descoberta de Fornecedores: um Chromium para a execução inteira,
 * compartilhado pelos três adapters (paginator, scraper, poster).
 *
 * Estes casos viviam em `test/unit/lib/puppeteer-browser.test.ts`, exercitando a
 * classe através das fachadas de módulo. As fachadas saíram com o Express — a
 * cobertura veio junto, agora contra a classe direto.
 */
describe("SuppliersBrowserSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cleanupBrowser.mockResolvedValue(undefined);
	});

	it("opens one browser and reuses it across the run", async () => {
		// Os três adapters compartilham o mesmo processo: abrir um por adapter
		// seria triplicar o consumo dentro do `mem_limit` do container.
		initializeBrowser.mockResolvedValue(makeSession());
		const session = new SuppliersBrowserSession();

		const first = await session.get();
		const second = await session.get();

		expect(initializeBrowser).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
	});

	it("closes the browser and lets the next run open a new one", async () => {
		const first = makeSession();
		const second = makeSession();
		initializeBrowser
			.mockResolvedValueOnce(first)
			.mockResolvedValueOnce(second);
		const session = new SuppliersBrowserSession();

		await session.get();
		await session.cleanup();
		const reopened = await session.get();

		expect(cleanupBrowser).toHaveBeenCalledWith(first.browser);
		expect(reopened).toBe(second);
	});

	it("is a no-op when no session was ever opened", async () => {
		// O `finally` da Descoberta chama isto mesmo quando a execução falhou
		// antes de abrir o browser.
		const session = new SuppliersBrowserSession();

		await expect(session.cleanup()).resolves.toBeUndefined();
		expect(cleanupBrowser).not.toHaveBeenCalled();
	});

	it("drops the reference even when closing the browser fails", async () => {
		// Se o cleanup lançasse e a referência ficasse, a execução seguinte
		// reusaria um browser morto.
		initializeBrowser.mockResolvedValue(makeSession());
		cleanupBrowser.mockRejectedValueOnce(new Error("close failed"));
		const session = new SuppliersBrowserSession();
		await session.get();

		await expect(session.cleanup()).resolves.toBeUndefined();

		initializeBrowser.mockResolvedValue(makeSession());
		await session.get();
		expect(initializeBrowser).toHaveBeenCalledTimes(2);
	});
});
