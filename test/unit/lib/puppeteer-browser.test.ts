import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { connect, descendantsOf, findPidByDebugPort, isAlive, killPid } =
	vi.hoisted(() => ({
		connect: vi.fn(),
		descendantsOf: vi.fn(),
		findPidByDebugPort: vi.fn(),
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
vi.mock("@/lib/process-tree.js", () => ({
	descendantsOf,
	findPidByDebugPort,
	isAlive,
	killPid,
}));

type FakeBrowser = ReturnType<typeof createFakeBrowser>;

/** Registro global da ordem das chamadas, para provar o "close antes do kill". */
let trace: string[] = [];

/**
 * `pid: null` é um browser CONECTADO (`puppeteer.connect`), cujo `process()` devolve
 * `null`. Não usar `undefined` como sentinela: um parâmetro com default o converte
 * em 4242, e o teste "sem processo" passava sem nunca exercitar o caso — foi assim que
 * a lacuna do fallback escapou da suíte.
 */
const createFakeBrowser = (pid: number | null = 4242) => {
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
		process: vi.fn(() => (pid === null ? null : { pid })),
		wsEndpoint: vi.fn(() => "ws://127.0.0.1:46611/devtools/browser/abc"),
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
	findPidByDebugPort.mockResolvedValue(undefined);
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

	it("does not signal anything when the pid cannot be resolved by any means", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		// process() é null E a porta não leva a nenhum processo.
		findPidByDebugPort.mockResolvedValue(undefined);

		await cleanupBrowser(browser as never);

		expect(browser.close).toHaveBeenCalledTimes(1);
		expect(killPid).not.toHaveBeenCalled();
	});
});

/**
 * O caso real de produção. O `puppeteer-real-browser` entrega um browser criado
 * por `puppeteer.connect`, para o qual `process()` é SEMPRE `null`. A suíte
 * inteira mockava `process()` com um pid, então o fallback de sinais parecia
 * funcionar e nunca rodava: sessões ficaram vivas por dias (2026-10-10).
 */
describe("cleanupBrowser with a connected browser (process() === null)", () => {
	it("finds the Chromium by its debug port and kills it when close() hangs", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		findPidByDebugPort.mockResolvedValue(5046);
		browser.close.mockImplementation(() => new Promise(() => {}));
		isAlive.mockReturnValue(true);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(findPidByDebugPort).toHaveBeenCalledWith(46611);
		expect(killPid).toHaveBeenCalledWith(5046, "SIGTERM");
		expect(killPid).toHaveBeenCalledWith(5046, "SIGKILL");
	});

	it("resolves the pid and snapshots the tree BEFORE closing, while the port still exists", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		findPidByDebugPort.mockImplementation(async () => {
			trace.push("resolve-pid");
			return 5046;
		});
		descendantsOf.mockImplementationOnce(async () => {
			trace.push("snapshot");
			return [9001];
		});

		await cleanupBrowser(browser as never);

		expect(descendantsOf).toHaveBeenCalledWith(5046);
		expect(trace.indexOf("resolve-pid")).toBeLessThan(trace.indexOf("snapshot"));
		expect(trace.indexOf("snapshot")).toBeLessThan(trace.indexOf("close"));
	});

	it("reaches renderers that outlive the main process, through the snapshot", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		findPidByDebugPort.mockResolvedValue(5046);
		descendantsOf.mockResolvedValueOnce([9001, 9002]).mockResolvedValueOnce([]);
		isAlive.mockImplementation((pid: number) => pid === 9001 || pid === 9002);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(killPid).toHaveBeenCalledWith(9001, "SIGTERM");
		expect(killPid).toHaveBeenCalledWith(9002, "SIGTERM");
	});

	it("does not scan /proc when the browser has its own child process", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);

		await cleanupBrowser(browser as never);

		expect(findPidByDebugPort).not.toHaveBeenCalled();
	});

	it("never throws when wsEndpoint() fails, and says so if close() also hangs", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		browser.wsEndpoint.mockImplementation(() => {
			throw new Error("disconnected");
		});
		browser.close.mockImplementation(() => new Promise(() => {}));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(cleanupBrowser(browser as never)).resolves.toBeUndefined();

		expect(killPid).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("pid could not be resolved"),
		);
	});

	it("warns when close() REJECTS and the pid is unknown — a rejected close ended nothing", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		browser.close.mockRejectedValue(new Error("Connection closed"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/close\(\) failed.*pid could not be resolved/),
		);
	});

	it("still finds the Chromium by port when process() itself throws", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		browser.process.mockImplementation(() => {
			throw new Error("half torn down");
		});
		findPidByDebugPort.mockResolvedValue(5046);
		browser.close.mockImplementation(() => new Promise(() => {}));
		isAlive.mockReturnValue(true);
		vi.spyOn(console, "warn").mockImplementation(() => {});

		await expect(cleanupBrowser(browser as never)).resolves.toBeUndefined();

		expect(killPid).toHaveBeenCalledWith(5046, "SIGTERM");
	});

	it("stays quiet when the graceful close worked even though the pid is unknown", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(null);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).not.toHaveBeenCalled();
	});
});

describe("cleanupBrowser logging of the signal fallback", () => {
	it("logs when the graceful close left survivors that had to be terminated", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		let alive = true;
		isAlive.mockImplementation(() => alive);
		killPid.mockImplementation((_pid: number, signal: string) => {
			if (signal === "SIGTERM") alive = false;
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/survived\. Sending SIGTERM/),
		);
		// Morreu no SIGTERM: não há motivo para falar de SIGKILL.
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("SIGKILL"));
	});

	it("says the close FAILED, not finished, when close() rejected and survivors remain", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		browser.close.mockRejectedValue(new Error("Connection closed"));
		isAlive.mockReturnValue(true);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).toHaveBeenCalledWith(
			expect.stringMatching(/Graceful close failed but/),
		);
		expect(warn).not.toHaveBeenCalledWith(
			expect.stringContaining("Graceful close finished"),
		);
	});

	it("says the close timed out when that is why survivors remained", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		browser.close.mockImplementation(() => new Promise(() => {}));
		isAlive.mockReturnValue(true);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).toHaveBeenCalledWith(expect.stringContaining("timed out after"));
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("ignored SIGTERM"));
	});

	it("is silent on a clean shutdown", async () => {
		const { cleanupBrowser } = await load();
		const browser = createFakeBrowser(4242);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await cleanupBrowser(browser as never);

		expect(warn).not.toHaveBeenCalled();
	});
});

describe("debugPortOf", () => {
	it("extracts the port from a browser wsEndpoint", async () => {
		const { debugPortOf } = await load();

		expect(debugPortOf("ws://127.0.0.1:46611/devtools/browser/abc")).toBe(46611);
	});

	it.each(["", "not a url", "ws://127.0.0.1/devtools/browser/abc"])(
		"returns undefined for %j",
		async (input) => {
			const { debugPortOf } = await load();

			expect(debugPortOf(input)).toBeUndefined();
		},
	);
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
