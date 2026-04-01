import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";

const useExternalXvfb =
	process.env.DOCKER === "true" || process.env.USE_EXTERNAL_XVFB === "true";

export const initializeBrowser = async () => {
	const { browser, page } = await connect({
		headless: false,
		args: [
			'--no-sandbox',
			'--disable-setuid-sandbox',
			'--disable-dev-shm-usage',
			'--disable-gpu'
		],
		customConfig: {},
		turnstile: true,
		connectOption: {},
		// No Docker usamos Xvfb do start.sh; evita dois servidores X.
		disableXvfb: useExternalXvfb,
		ignoreAllFlags: false,
		plugins: [AdblockerPlugin(), StealthPlugin()],
	});

	await page.setViewport({
		width: 1920,
		height: 1080,
	});

	page.setDefaultTimeout(Number(process.env.TIMEOUT) || 3000);

	return { browser, page };
};

export const cleanupBrowser = async (
	browser: Awaited<ReturnType<typeof connect>>["browser"],
): Promise<void> => {
	const pages = await browser.pages();
	if (pages) {
		await Promise.all(pages.map((page) => page.close()));
	}

	const childProcess = browser.process();
	if (childProcess) {
		childProcess.kill();
	}

	await browser.close();

	if (browser?.process()) {
		browser.process()?.kill("SIGINT");
	}
};
