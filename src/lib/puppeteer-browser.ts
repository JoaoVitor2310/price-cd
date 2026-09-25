import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";
import { delay } from "@/helpers/utils.js";
import { descendantsOf, isAlive, killPid } from "@/lib/process-tree.js";

type BrowserInstance = Awaited<ReturnType<typeof connect>>["browser"];

const useExternalXvfb =
	process.env.DOCKER === "true" || process.env.USE_EXTERNAL_XVFB === "true";

/**
 * Trava: nenhum teste abre browser por acidente.
 *
 * Sem isto, qualquer teste que apenas **suba o app** dispara o primeiro tick do
 * agendador de bump, que abre um Chromium de verdade. Aconteceu: uma rodada da
 * suíte encheu a máquina de janelas do Chrome. Em WSL é pior ainda, porque o
 * `puppeteer-real-browser` encontra o Chrome do **Windows** via interop — então
 * nem "não tenho Chrome instalado no Linux" protege.
 *
 * A proteção é estrutural de propósito. Um flag de ambiente que cada arquivo de
 * teste precisa lembrar de setar não é proteção: basta um esquecimento. Aqui,
 * esquecer produz uma falha alta e legível em vez de dezenas de janelas.
 *
 * Um teste que precisa exercitar código de browser mocka `initializeBrowser` —
 * é o que os testes de `fetch-list-topic`, do bumper e das sessões já fazem.
 *
 * A exceção é o teste desta própria função, que mocka o `connect` do
 * `puppeteer-real-browser` e portanto exercita tudo aqui sem abrir processo
 * nenhum. Esse caso declara `ALLOW_BROWSER_LAUNCH_IN_TESTS=true` — explícito,
 * um arquivo só, e visível em code review.
 */
function refuseToLaunchUnderTest(): void {
	if (!process.env.VITEST) return;
	if (process.env.ALLOW_BROWSER_LAUNCH_IN_TESTS === "true") return;

	throw new Error(
		"initializeBrowser() was called from the test suite. No test may open a " +
			'real browser — mock "@/lib/puppeteer-browser.js", or override the port ' +
			"or provider that reaches it.",
	);
}

export const initializeBrowser = async () => {
	refuseToLaunchUnderTest();

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

export type SharedSession = Awaited<ReturnType<typeof initializeBrowser>>;
