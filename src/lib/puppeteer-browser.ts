import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";

type BrowserInstance = Awaited<ReturnType<typeof connect>>["browser"];

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
	browser: BrowserInstance,
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

// ---------------------------------------------------------------------------
// Singleton session (browser + page) + serial queue
// ---------------------------------------------------------------------------

type SharedSession = Awaited<ReturnType<typeof initializeBrowser>>;

let _session: SharedSession | null = null;
let _sessionPromise: Promise<SharedSession> | null = null;
let _queue: Promise<unknown> = Promise.resolve();

export const getSharedSession = async (): Promise<SharedSession> => {
	if (_session) {
		try {
			await _session.browser.pages(); // throws if the process died
			return _session;
		} catch {
			_session = null;
			_sessionPromise = null;
		}
	}

	if (!_sessionPromise) {
		_sessionPromise = initializeBrowser()
			.then((session) => {
				_session = session;
				_sessionPromise = null;
				return session;
			})
			.catch((err) => {
				_sessionPromise = null;
				throw err;
			});
	}

	return _sessionPromise;
};

export const invalidateSharedSession = (): void => {
	_session = null;
	_sessionPromise = null;
};

/**
 * Enqueue a task that requires the browser so that only one runs at a time.
 * If the previous task threw, this one still runs (the queue never stalls).
 */
export const enqueueWithBrowser = <T>(task: () => Promise<T>): Promise<T> => {
	const result = (_queue as Promise<unknown>).then(
		() => task(),
		() => task(),
	) as Promise<T>;
	_queue = result.then(
		() => {},
		() => {},
	);
	return result;
};
