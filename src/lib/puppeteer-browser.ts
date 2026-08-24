import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";
import { delay } from "@/helpers/utils.js";
import { descendantsOf, isAlive, killPid } from "@/lib/process-tree.js";

type BrowserInstance = Awaited<ReturnType<typeof connect>>["browser"];

const useExternalXvfb =
	process.env.DOCKER === "true" || process.env.USE_EXTERNAL_XVFB === "true";

export const initializeBrowser = async () => {
	const { browser, page } = await connect({
		headless: false,
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-dev-shm-usage",
			"--disable-gpu",
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

const envMs = (name: string, fallback: number): number => {
	const value = Number(process.env[name]);
	return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Teto para o encerramento ordenado; passou disso, parte-se para o sinal. */
const closeTimeoutMs = () => envMs("BROWSER_CLOSE_TIMEOUT_MS", 15_000);
/** Janela entre o SIGTERM e o SIGKILL. */
const killGraceMs = () => envMs("BROWSER_KILL_GRACE_MS", 3_000);

/** `true` se a promise assentou (resolvida ou rejeitada) dentro do prazo. */
const settledWithin = async (
	promise: Promise<unknown>,
	ms: number,
): Promise<boolean> => {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<false>((resolve) => {
		timer = setTimeout(() => resolve(false), ms);
		timer.unref?.();
	});

	try {
		return await Promise.race([
			promise.then(
				() => true,
				() => true,
			),
			timeout,
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
};

/** Espera o pid sumir; `false` se ainda estiver vivo quando o prazo acabar. */
const waitForExit = async (pid: number, ms: number): Promise<boolean> => {
	const deadline = Date.now() + ms;
	while (true) {
		if (!isAlive(pid)) return true;
		if (Date.now() >= deadline) return false;
		await delay(100);
	}
};

/**
 * Encerra o browser e garante que nenhum processo da árvore sobreviva.
 *
 * A ordem importa e já esteve invertida (ver `docs/IMPROVEMENTS.md`):
 *
 * 1. **Snapshot da árvore antes de qualquer coisa.** Depois que o processo
 *    principal morre, os filhos são reparentados para o `init` e não há mais
 *    como descobrir que eram dele.
 * 2. **`close()` primeiro.** É o encerramento ordenado via CDP — o único que
 *    derruba renderers, GPU process e zygote. Matar o pai antes disso é
 *    justamente o que órfã a árvore.
 * 3. **Sinal só como fallback**, e alcançando todo mundo que sobreviveu:
 *    SIGTERM, janela de graça, SIGKILL.
 *
 * Nunca lança: cleanup é sempre chamado em caminho de erro.
 */
export const cleanupBrowser = async (
	browser: BrowserInstance,
): Promise<void> => {
	const pid = browser.process()?.pid;
	const tree = pid !== undefined ? await descendantsOf(pid) : [];

	// Fechar as páginas antes evita que um `beforeunload` trave o close().
	await settledWithin(
		browser
			.pages()
			.then((pages) => Promise.all(pages.map((page) => page.close()))),
		closeTimeoutMs(),
	);

	await settledWithin(browser.close(), closeTimeoutMs());

	if (pid === undefined) return;

	// Quem ficou de pé: o snapshot inicial, o pid, e filhos nascidos depois dele.
	const candidates = new Set([...tree, ...(await descendantsOf(pid)), pid]);
	const survivors = [...candidates].filter(isAlive);
	if (survivors.length === 0) return;

	for (const target of survivors) killPid(target, "SIGTERM");
	await Promise.all(
		survivors.map((target) => waitForExit(target, killGraceMs())),
	);

	for (const target of survivors.filter(isAlive)) killPid(target, "SIGKILL");
};

// ---------------------------------------------------------------------------
// Singleton session (browser + page) + serial queue
// ---------------------------------------------------------------------------

type SharedSession = Awaited<ReturnType<typeof initializeBrowser>>;

let _session: SharedSession | null = null;
let _sessionPromise: Promise<SharedSession> | null = null;
let _sessionOpenedAt = 0;
let _queue: Promise<unknown> = Promise.resolve();

/**
 * Incrementado a cada invalidação. Uma sessão que estava nascendo enquanto a
 * anterior era invalidada tem geração velha: ela é fechada em vez de publicada,
 * senão o browser tardio sobrescreveria `_session` e vazaria.
 */
let _generation = 0;

/** Idade máxima da sessão; 0 desliga a reciclagem. Default: 30 min. */
const sessionMaxAgeMs = (): number => {
	const value = Number(process.env.BROWSER_SESSION_MAX_AGE_MS);
	if (Number.isFinite(value) && value >= 0) return value;
	return 30 * 60 * 1000;
};

const isExpired = (): boolean => {
	const maxAge = sessionMaxAgeMs();
	return maxAge > 0 && Date.now() - _sessionOpenedAt > maxAge;
};

const openSession = (): Promise<SharedSession> => {
	const generation = _generation;

	const promise = initializeBrowser().then(
		async (session) => {
			if (generation !== _generation) {
				// Invalidada enquanto abria: fecha em vez de publicar.
				await cleanupBrowser(session.browser);
				throw new Error("Shared browser session was invalidated while opening");
			}
			_session = session;
			_sessionPromise = null;
			_sessionOpenedAt = Date.now();
			return session;
		},
		(error) => {
			if (generation === _generation) _sessionPromise = null;
			throw error;
		},
	);

	return promise;
};

export const getSharedSession = async (): Promise<SharedSession> => {
	if (_session) {
		try {
			await _session.browser.pages(); // throws if the process died
			// Reciclagem preventiva: um Chromium de horas acumula memória, e
			// quanto mais velho ele fica, mais perto do OOM a máquina chega.
			if (!isExpired()) return _session;
			await invalidateSharedSession();
		} catch {
			// Browser morto — o cleanup ainda é obrigatório: quando o OOM killer
			// mata só um renderer, o resto da árvore continua vivo e órfão.
			await invalidateSharedSession();
		}
	}

	if (!_sessionPromise) {
		_sessionPromise = openSession();
	}

	return _sessionPromise;
};

/**
 * Descarta a sessão compartilhada FECHANDO o browser antes de zerar as
 * referências. Zerar sem fechar era o vazamento: cada falha de scraping
 * abandonava um Chromium vivo e a chamada seguinte subia outro.
 *
 * O chamador precisa dar `await` antes de propagar o erro — do contrário o
 * cleanup corre solto e o próximo browser nasce antes de o anterior morrer.
 */
export const invalidateSharedSession = async (): Promise<void> => {
	_generation++;

	const session = _session;
	const pending = _sessionPromise;
	_session = null;
	_sessionPromise = null;
	_sessionOpenedAt = 0;

	if (session) await cleanupBrowser(session.browser);
	// Sessão em voo: `openSession` fecha o browser tardio por causa da geração.
	if (pending) await pending.catch(() => {});
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

// ---------------------------------------------------------------------------
// Suppliers-scoped session (isolated from AllKeyShop shared session)
// One Chrome process for the entire findNewSuppliers run.
// Adapters open/close individual pages; the factory owns the browser lifecycle.
// ---------------------------------------------------------------------------

let _suppliersSession: SharedSession | null = null;

/**
 * Returns the suppliers browser session, initializing it on first call.
 * All three adapters (paginator, scraper, poster) share this single process.
 */
export const getSuppliersSession = async (): Promise<SharedSession> => {
	if (!_suppliersSession) {
		_suppliersSession = await initializeBrowser();
	}
	return _suppliersSession;
};

/**
 * Closes the suppliers browser and resets the session.
 * Should be called in the `finally` block of the suppliers run.
 * Safe to call even if the session was never initialized.
 */
export const cleanupSuppliersSession = async (): Promise<void> => {
	if (_suppliersSession) {
		await cleanupBrowser(_suppliersSession.browser).catch(() => {});
		_suppliersSession = null;
	}
};
