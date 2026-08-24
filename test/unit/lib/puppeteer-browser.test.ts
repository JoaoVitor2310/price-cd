import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, descendantsOf, isAlive, killPid } = vi.hoisted(() => ({
	connect: vi.fn(),
	descendantsOf: vi.fn(),
	isAlive: vi.fn(),
	killPid: vi.fn(),
}));

vi.mock("puppeteer-real-browser", () => ({ connect }));
vi.mock("puppeteer-extra-plugin-adblocker", () => ({ default: () => ({}) }));
vi.mock("puppeteer-extra-plugin-stealth", () => ({ default: () => ({}) }));
vi.mock("@/lib/process-tree.js", () => ({ descendantsOf, isAlive, killPid }));

type FakeBrowser = ReturnType<typeof createFakeBrowser>;

/** Registro global da ordem das chamadas, para provar o "close antes do kill". */
let trace: string[] = [];

const createFakeBrowser = (pid: number | undefined = 4242) => {
	const pages = [
		{ close: vi.fn().mockResolvedValue(undefined) },
		{ close: vi.fn().mockResolvedValue(undefined) },
	];

	return {
		pages: vi.fn(async () => {
			trace.push("pages");
			return pages;
		}),
		close: vi.fn(async () => {
			trace.push("close");
		}),
		process: vi.fn(() => (pid === undefined ? null : { pid })),
		_pages: pages,
	};
};

const createFakeSession = (browser: FakeBrowser) => ({
	browser,
	page: {
		setViewport: vi.fn().mockResolvedValue(undefined),
		setDefaultTimeout: vi.fn(),
	},
});

const load = async () => {
	vi.resetModules();
	return import("@/lib/puppeteer-browser.js");
};

beforeEach(() => {
	trace = [];
	vi.clearAllMocks();
	descendantsOf.mockResolvedValue([]);
	isAlive.mockReturnValue(false);
	killPid.mockImplementation((pid: number, signal: string) => {
		trace.push(`kill:${pid}:${signal}`);
	});
	process.env.BROWSER_CLOSE_TIMEOUT_MS = "100";
	process.env.BROWSER_KILL_GRACE_MS = "50";
	delete process.env.BROWSER_SESSION_MAX_AGE_MS;
});

afterEach(() => {
	delete process.env.BROWSER_CLOSE_TIMEOUT_MS;
	delete process.env.BROWSER_KILL_GRACE_MS;
	delete process.env.BROWSER_SESSION_MAX_AGE_MS;
});

describe("cleanupBrowser", () => {
	it("closes the browser before signalling anything (ordered CDP shutdown)", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser();

		await cleanupBrowser(browser as never);

		expect(browser.close).toHaveBeenCalledTimes(1);
		expect(killPid).not.toHaveBeenCalled();
		// close() é o que derruba renderers/GPU/zygote; matar antes órfã a árvore.
		expect(trace).toEqual(["pages", "close"]);
	});

	it("closes every open page before closing the browser", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser();

		await cleanupBrowser(browser as never);

		for (const page of browser._pages) {
			expect(page.close).toHaveBeenCalledTimes(1);
		}
	});

	it("snapshots the process tree before closing, so orphans stay reachable", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		// Renderer que sobrevive ao close (caso do OOM matando só um filho).
		descendantsOf.mockResolvedValueOnce([9001]).mockResolvedValueOnce([]);
		isAlive.mockImplementation((pid: number) => pid === 9001);

		await cleanupBrowser(browser as never);

		expect(killPid).toHaveBeenCalledWith(9001, "SIGTERM");
		expect(killPid).toHaveBeenCalledWith(9001, "SIGKILL");
		expect(trace[0]).toBe("pages");
		expect(trace.indexOf("close")).toBeLessThan(
			trace.indexOf("kill:9001:SIGTERM"),
		);
	});

	it("escalates to SIGKILL only after the grace window", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		// Morre no SIGTERM: nada de SIGKILL.
		let alive = true;
		isAlive.mockImplementation(() => alive);
		killPid.mockImplementation((pid: number, signal: string) => {
			trace.push(`kill:${pid}:${signal}`);
			if (signal === "SIGTERM") alive = false;
		});

		await cleanupBrowser(browser as never);

		expect(killPid).toHaveBeenCalledWith(4242, "SIGTERM");
		expect(killPid).not.toHaveBeenCalledWith(4242, "SIGKILL");
	});

	it("falls back to the signal when close() hangs past the timeout", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		browser.close.mockImplementation(() => new Promise(() => {})); // trava
		isAlive.mockReturnValue(true);

		await cleanupBrowser(browser as never);

		expect(killPid).toHaveBeenCalledWith(4242, "SIGTERM");
		expect(killPid).toHaveBeenCalledWith(4242, "SIGKILL");
	});

	it("never throws when the browser is already dead", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		browser.pages.mockRejectedValue(new Error("Target closed"));
		browser.close.mockRejectedValue(new Error("Target closed"));
		isAlive.mockImplementation((pid: number) => pid === 4242);

		await expect(cleanupBrowser(browser as never)).resolves.toBeUndefined();
		expect(killPid).toHaveBeenCalledWith(4242, "SIGTERM");
	});

	it("does not signal anything when there is no child process", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(undefined);

		await cleanupBrowser(browser as never);

		expect(browser.close).toHaveBeenCalledTimes(1);
		expect(killPid).not.toHaveBeenCalled();
	});
});

describe("shared session", () => {
	it("reuses the same browser while it is alive", async () => {
		const browser = createFakeBrowser();
		connect.mockResolvedValue(createFakeSession(browser));
		const { getSharedSession } = await load();

		const first = await getSharedSession();
		const second = await getSharedSession();

		expect(first).toBe(second);
		expect(connect).toHaveBeenCalledTimes(1);
	});

	it("closes the browser on invalidate instead of just dropping the reference", async () => {
		const browser = createFakeBrowser();
		connect.mockResolvedValue(createFakeSession(browser));
		const { getSharedSession, invalidateSharedSession } = await load();

		await getSharedSession();
		await invalidateSharedSession();

		// Era este o vazamento: `_session = null` sem fechar o Chromium.
		expect(browser.close).toHaveBeenCalledTimes(1);
	});

	it("opens a fresh browser after an invalidation", async () => {
		const first = createFakeBrowser();
		const second = createFakeBrowser();
		connect
			.mockResolvedValueOnce(createFakeSession(first))
			.mockResolvedValueOnce(createFakeSession(second));
		const { getSharedSession, invalidateSharedSession } = await load();

		await getSharedSession();
		await invalidateSharedSession();
		const session = await getSharedSession();

		expect(connect).toHaveBeenCalledTimes(2);
		expect(session.browser).toBe(second);
	});

	it("reaps the dead session when the health check fails", async () => {
		const dead = createFakeBrowser(4242);
		const fresh = createFakeBrowser(4343);
		connect
			.mockResolvedValueOnce(createFakeSession(dead))
			.mockResolvedValueOnce(createFakeSession(fresh));
		const { getSharedSession } = await load();

		await getSharedSession();
		// O OOM killer levou um renderer: pages() lança, mas a árvore continua viva.
		dead.pages.mockRejectedValue(new Error("Target closed"));
		isAlive.mockImplementation((pid: number) => pid === 4242);

		const session = await getSharedSession();

		expect(session.browser).toBe(fresh);
		expect(dead.close).toHaveBeenCalledTimes(1);
		expect(killPid).toHaveBeenCalledWith(4242, "SIGKILL");
	});

	it("recycles the session once it is older than the configured max age", async () => {
		process.env.BROWSER_SESSION_MAX_AGE_MS = "1";
		const first = createFakeBrowser();
		const second = createFakeBrowser();
		connect
			.mockResolvedValueOnce(createFakeSession(first))
			.mockResolvedValueOnce(createFakeSession(second));
		const { getSharedSession } = await load();

		await getSharedSession();
		await new Promise((resolve) => setTimeout(resolve, 5));
		const session = await getSharedSession();

		expect(first.close).toHaveBeenCalledTimes(1);
		expect(session.browser).toBe(second);
	});

	it("keeps the session when recycling is disabled", async () => {
		process.env.BROWSER_SESSION_MAX_AGE_MS = "0";
		const browser = createFakeBrowser();
		connect.mockResolvedValue(createFakeSession(browser));
		const { getSharedSession } = await load();

		const first = await getSharedSession();
		await new Promise((resolve) => setTimeout(resolve, 5));

		expect(await getSharedSession()).toBe(first);
		expect(connect).toHaveBeenCalledTimes(1);
	});

	it("closes a browser that finishes opening after an invalidation", async () => {
		const late = createFakeBrowser();
		let release: (() => void) | undefined;
		connect.mockImplementation(
			() =>
				new Promise((resolve) => {
					release = () => resolve(createFakeSession(late));
				}),
		);
		const { getSharedSession, invalidateSharedSession } = await load();

		const pending = getSharedSession().catch(() => "rejected");
		const invalidation = invalidateSharedSession();
		release?.();

		await invalidation;
		// Sem o controle de geração, este browser tardio sobrescreveria a
		// referência zerada e ficaria vivo para sempre.
		await expect(pending).resolves.toBe("rejected");
		expect(late.close).toHaveBeenCalledTimes(1);
	});
});

describe("suppliers session", () => {
	it("closes the browser and lets the next run open a new one", async () => {
		const first = createFakeBrowser();
		const second = createFakeBrowser();
		connect
			.mockResolvedValueOnce(createFakeSession(first))
			.mockResolvedValueOnce(createFakeSession(second));
		const { getSuppliersSession, cleanupSuppliersSession } = await load();

		await getSuppliersSession();
		await cleanupSuppliersSession();
		const session = await getSuppliersSession();

		expect(first.close).toHaveBeenCalledTimes(1);
		expect(session.browser).toBe(second);
	});

	it("is a no-op when no suppliers session was ever opened", async () => {
		const { cleanupSuppliersSession } = await load();

		await expect(cleanupSuppliersSession()).resolves.toBeUndefined();
		expect(connect).not.toHaveBeenCalled();
	});
});
