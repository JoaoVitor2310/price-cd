import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock de initializeBrowser e cleanupBrowser antes de importar o módulo
// ---------------------------------------------------------------------------
const mockPages = vi.fn().mockResolvedValue([]);
const mockBrowser = { pages: mockPages };
const mockPage = {
	browserContext: vi.fn().mockReturnValue({ setCookie: vi.fn().mockResolvedValue(undefined) }),
	goto: vi.fn().mockResolvedValue(undefined),
	click: vi.fn().mockResolvedValue(undefined),
	waitForNetworkIdle: vi.fn().mockResolvedValue(undefined),
};

const initializeBrowserMock = vi.fn().mockResolvedValue({ browser: mockBrowser, page: mockPage });
const cleanupBrowserMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/puppeteer-browser.js", () => ({
	initializeBrowser: initializeBrowserMock,
	cleanupBrowser: cleanupBrowserMock,
}));

// Importa depois do mock para garantir que o módulo usa os mocks
const { PuppeteerSteamTradesBumper } = await import(
	"@/infrastructure/bump/puppeteer-steam-trades-bumper.js"
);

// ---------------------------------------------------------------------------

describe("PuppeteerSteamTradesBumper", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPages.mockResolvedValue([]);
		mockPage.goto.mockResolvedValue(undefined);
		mockPage.click.mockResolvedValue(undefined);
		mockPage.waitForNetworkIdle.mockResolvedValue(undefined);
		mockPage.browserContext.mockReturnValue({ setCookie: vi.fn().mockResolvedValue(undefined) });
	});

	it("creates a new browser session on the first call", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		await bumper.bumpUserTopics("76561198000000000");

		expect(initializeBrowserMock).toHaveBeenCalledTimes(1);
	});

	it("reuses the same browser session across multiple calls", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		await bumper.bumpUserTopics("76561198000000000");
		await bumper.bumpUserTopics("76561198000000000");

		expect(initializeBrowserMock).toHaveBeenCalledTimes(1);
	});

	it("injects the PHPSESSID cookie only when creating a new session", async () => {
		const setCookieMock = vi.fn().mockResolvedValue(undefined);
		mockPage.browserContext.mockReturnValue({ setCookie: setCookieMock });

		const bumper = new PuppeteerSteamTradesBumper("my-session");

		await bumper.bumpUserTopics("76561198000000000");
		await bumper.bumpUserTopics("76561198000000000");

		expect(setCookieMock).toHaveBeenCalledTimes(1);
		expect(setCookieMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: "PHPSESSID", value: "my-session" }),
		);
	});

	it("recreates the session when the browser process has died", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		// Primeira chamada — cria sessão
		await bumper.bumpUserTopics("76561198000000000");
		expect(initializeBrowserMock).toHaveBeenCalledTimes(1);

		// Simula morte do Chrome: pages() passa a rejeitar
		mockPages.mockRejectedValueOnce(new Error("Browser process died"));

		// Segunda chamada — detecta browser morto e recria
		await bumper.bumpUserTopics("76561198000000000");
		expect(initializeBrowserMock).toHaveBeenCalledTimes(2);
	});

	it("calls cleanupBrowser when recovering from a dead browser", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		await bumper.bumpUserTopics("76561198000000000");

		mockPages.mockRejectedValueOnce(new Error("Browser process died"));

		await bumper.bumpUserTopics("76561198000000000");

		// cleanupBrowser deve ter sido chamado para descartar a sessão morta
		expect(cleanupBrowserMock).toHaveBeenCalledTimes(1);
	});

	it("calls cleanupBrowser on dispose and clears the session", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		await bumper.bumpUserTopics("76561198000000000");
		await bumper.dispose();

		expect(cleanupBrowserMock).toHaveBeenCalledTimes(1);

		// Após dispose, próxima chamada deve criar nova sessão
		await bumper.bumpUserTopics("76561198000000000");
		expect(initializeBrowserMock).toHaveBeenCalledTimes(2);
	});

	it("dispose is a no-op when called before any bump", async () => {
		const bumper = new PuppeteerSteamTradesBumper("session-abc");

		await expect(bumper.dispose()).resolves.toBeUndefined();
		expect(cleanupBrowserMock).not.toHaveBeenCalled();
	});
});
