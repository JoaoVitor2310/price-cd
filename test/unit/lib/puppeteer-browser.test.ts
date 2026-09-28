import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, descendantsOf, isAlive, killPid } = vi.hoisted(() => ({
	connect: vi.fn(),
	descendantsOf: vi.fn(),
	isAlive: vi.fn(),
	killPid: vi.fn(),
}));

// Este arquivo mocka o `connect` do puppeteer-real-browser, então exercita
// `initializeBrowser` inteiro sem abrir processo nenhum. É a única exceção à
// trava que impede a suíte de subir um browser de verdade.
process.env.ALLOW_BROWSER_LAUNCH_IN_TESTS = "true";

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

/**
 * Esta função era exercitada de lado, pelos testes das sessões que viviam aqui.
 * Eles saíram para `test/unit/infrastructure/browser/`, contra as classes direto
 * — então a cobertura de `initializeBrowser` passou a ser explícita.
 */
describe("initializeBrowser", () => {
	it("configures the page it hands back", async () => {
		process.env.TIMEOUT = "7000";
		const browser = createFakeBrowser();
		const session = {
			browser,
			page: {
				setViewport: vi.fn().mockResolvedValue(undefined),
				setDefaultTimeout: vi.fn(),
			},
		};
		connect.mockResolvedValue(session);
		const { initializeBrowser } = await load();

		const opened = await initializeBrowser();

		expect(opened.browser).toBe(browser);
		expect(session.page.setViewport).toHaveBeenCalledWith({
			width: 1920,
			height: 1080,
		});
		expect(session.page.setDefaultTimeout).toHaveBeenCalledWith(7000);
		delete process.env.TIMEOUT;
	});
});
