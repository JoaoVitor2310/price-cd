import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";

export const initializeBrowser = async () => {
	const { browser, page } = await connect({
		headless: true,
		args: [],
		customConfig: {},
		turnstile: true,
		connectOption: {},
		disableXvfb: false,
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
