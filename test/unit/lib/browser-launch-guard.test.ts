import { describe, expect, it } from "vitest";

/**
 * A trava que impede a suíte de abrir um browser de verdade.
 *
 * Existe porque registrar o primeiro tick do bump no `OnApplicationBootstrap`
 * fez qualquer teste que apenas subisse o `AppModule` abrir um Chromium — uma
 * rodada encheu a máquina de janelas do Chrome. Em WSL isso acontece mesmo sem
 * Chrome instalado no Linux: o `puppeteer-real-browser` acha o do Windows via
 * interop.
 *
 * NOTA: este arquivo **não** define `ALLOW_BROWSER_LAUNCH_IN_TESTS`. É de
 * propósito — é o caminho que lança que está sob teste.
 */
describe("browser launch guard", () => {
	it("refuses to launch a browser from inside the test suite", async () => {
		const { initializeBrowser } = await import("@/lib/puppeteer-browser.js");

		await expect(initializeBrowser()).rejects.toThrow(
			/was called from the test suite/,
		);
	});

	it("names what to do instead of only saying no", async () => {
		// Uma trava que só bloqueia deixa quem esbarra nela sem saída.
		const { initializeBrowser } = await import("@/lib/puppeteer-browser.js");

		await expect(initializeBrowser()).rejects.toThrow(/mock|override/);
	});
});
