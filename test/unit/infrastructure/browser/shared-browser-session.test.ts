import { beforeEach, describe, expect, it, vi } from "vitest";

const { initializeBrowser, cleanupBrowser } = vi.hoisted(() => ({
	initializeBrowser: vi.fn(),
	cleanupBrowser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/puppeteer-browser.js", () => ({ initializeBrowser, cleanupBrowser }));

const { SharedBrowserSession } = await import(
	"@/infrastructure/browser/shared-browser-session.js"
);

/** Um browser de mentira que responde ao health check. */
const makeBrowser = (alive = true) => ({
	browser: {
		pages: vi.fn(alive ? async () => [] : async () => {
			throw new Error("browser is dead");
		}),
	},
	page: {},
});

describe("SharedBrowserSession", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cleanupBrowser.mockResolvedValue(undefined);
	});

	const never = () => 0;

	it("opens one browser and reuses it", async () => {
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(never);

		await session.get();
		await session.get();

		expect(initializeBrowser).toHaveBeenCalledTimes(1);
	});

	it("opens only one browser for concurrent callers", async () => {
		// Sem isto, duas requisições simultâneas subiriam dois Chromium — o
		// vazamento que este projeto já pagou caro.
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(never);

		await Promise.all([session.get(), session.get(), session.get()]);

		expect(initializeBrowser).toHaveBeenCalledTimes(1);
	});

	it("closes the browser before dropping the reference", async () => {
		// Zerar sem fechar era o vazamento: cada falha abandonava um Chromium
		// vivo e a chamada seguinte subia outro.
		const first = makeBrowser();
		initializeBrowser.mockResolvedValue(first);
		const session = new SharedBrowserSession(never);
		await session.get();

		await session.invalidate();

		expect(cleanupBrowser).toHaveBeenCalledWith(first.browser);
	});

	it("replaces a dead browser instead of handing it out", async () => {
		// Quando o OOM killer mata só um renderer, o resto da árvore segue vivo
		// e órfão — por isso o cleanup acontece mesmo com o browser morto.
		initializeBrowser
			.mockResolvedValueOnce(makeBrowser(false))
			.mockResolvedValueOnce(makeBrowser(true));
		const session = new SharedBrowserSession(never);
		await session.get();

		await session.get();

		expect(cleanupBrowser).toHaveBeenCalledTimes(1);
		expect(initializeBrowser).toHaveBeenCalledTimes(2);
	});

	it("recycles a session older than the maximum age", async () => {
		// Um Chromium de horas acumula memória; quanto mais velho, mais perto do
		// OOM a máquina chega.
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(() => 1);
		await session.get();
		await new Promise((resolve) => setTimeout(resolve, 5));

		await session.get();

		expect(initializeBrowser).toHaveBeenCalledTimes(2);
	});

	it("never recycles when the maximum age is zero", async () => {
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(() => 0);
		await session.get();
		await new Promise((resolve) => setTimeout(resolve, 5));

		await session.get();

		expect(initializeBrowser).toHaveBeenCalledTimes(1);
	});

	it("closes a browser that finished opening after an invalidation", async () => {
		// A corrida que a contagem de geração resolve: sem ela, o browser
		// atrasado sobrescreveria a referência e vazaria.
		const late = makeBrowser();
		let release: (value: unknown) => void = () => {};
		initializeBrowser.mockReturnValue(
			new Promise((resolve) => {
				release = resolve;
			}),
		);
		const session = new SharedBrowserSession(never);

		const pending = session.get();
		// `invalidate()` espera a sessão em voo de propósito — é o que impede o
		// próximo browser de nascer antes de o anterior morrer. Por isso o
		// release precisa vir antes do await.
		const invalidating = session.invalidate();
		release(late);
		await invalidating;
		await pending.catch(() => {});

		expect(cleanupBrowser).toHaveBeenCalledWith(late.browser);
	});

	it("keeps the queue running after a task throws", async () => {
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(never);

		const failed = session.enqueue(async () => {
			throw new Error("boom");
		});
		await expect(failed).rejects.toThrow("boom");

		await expect(session.enqueue(async () => "ok")).resolves.toBe("ok");
	});

	it("runs queued tasks one at a time", async () => {
		initializeBrowser.mockResolvedValue(makeBrowser());
		const session = new SharedBrowserSession(never);
		let running = 0;
		let peak = 0;

		const task = async () => {
			running++;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 2));
			running--;
		};

		await Promise.all([session.enqueue(task), session.enqueue(task), session.enqueue(task)]);

		expect(peak).toBe(1);
	});
});
