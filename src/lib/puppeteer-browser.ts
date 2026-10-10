import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";
import { delay } from "@/helpers/utils.js";
import {
	descendantsOf,
	findPidByDebugPort,
	isAlive,
	killPid,
} from "@/lib/process-tree.js";

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

/** Como uma promise terminou dentro do prazo — ou que não terminou. */
type Settlement = "resolved" | "rejected" | "timeout";

/**
 * Espera a promise assentar por até `ms`, sem nunca lançar.
 *
 * Distingue `rejected` de `resolved` de propósito: um `close()` que REJEITA (o
 * socket CDP já caiu) não encerrou nada, e tratá-lo como "terminou bem" fazia o
 * log afirmar um encerramento limpo justamente quando o processo podia estar vivo.
 */
const settleWithin = async (
	promise: Promise<unknown>,
	ms: number,
): Promise<Settlement> => {
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<"timeout">((resolve) => {
		timer = setTimeout(() => resolve("timeout"), ms);
		timer.unref?.();
	});

	try {
		return await Promise.race([
			promise.then(
				(): Settlement => "resolved",
				(): Settlement => "rejected",
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

/** Porta de debug de uma `wsEndpoint` (`ws://127.0.0.1:46611/devtools/...`). */
export const debugPortOf = (wsEndpoint: string): number | undefined => {
	try {
		const port = Number(new URL(wsEndpoint).port);
		return Number.isInteger(port) && port > 0 ? port : undefined;
	} catch {
		return undefined;
	}
};

/**
 * O pid do processo principal do Chromium, ou `undefined` se não der para saber.
 *
 * `browser.process()` só existe para browsers que o Puppeteer lançou. O
 * `puppeteer-real-browser` lança o Chrome por conta própria (chrome-launcher) e
 * entrega um browser CONECTADO, para o qual `process()` é sempre `null`
 * (documentado em `Browser.process()`). Confiar só nele deixava o fallback de
 * sinais inalcançável em produção: bastava o `close()` não terminar, coisa que
 * acontece com CPU roubada, para o Chromium ficar vivo para sempre. A porta de
 * debug está sempre na `wsEndpoint()`, e dela se chega ao processo.
 */
const resolveBrowserPid = async (
	browser: BrowserInstance,
): Promise<number | undefined> => {
	// Cada acesso ao browser é guardado: um objeto meio desmontado pode lançar em
	// qualquer método, e `cleanupBrowser` roda justamente em caminho de erro.
	try {
		const own = browser.process()?.pid;
		if (own !== undefined) return own;
	} catch {
		// segue para a porta de debug
	}

	try {
		const port = debugPortOf(browser.wsEndpoint());
		return port === undefined ? undefined : await findPidByDebugPort(port);
	} catch {
		return undefined;
	}
};

/**
 * Encerra o browser e garante que nenhum processo da árvore sobreviva.
 *
 * A ordem importa e já esteve invertida (ver `docs/IMPROVEMENTS.md`):
 *
 * 1. **Snapshot da árvore antes de qualquer coisa.** Depois que o processo
 *    principal morre, os filhos são reparentados para o `init` e não há mais
 *    como descobrir que eram dele. O pid também é resolvido aqui: depois do
 *    close, nem o processo nem a porta existem mais para consultar.
 * 2. **`close()` primeiro.** É o encerramento ordenado via CDP — o único que
 *    derruba renderers, GPU process e zygote. Matar o pai antes disso é
 *    justamente o que órfã a árvore.
 * 3. **Sinal só como fallback**, e alcançando todo mundo que sobreviveu:
 *    SIGTERM, janela de graça, SIGKILL.
 *
 * O fallback é silencioso por natureza — quando funciona, ninguém percebe —, então
 * cada vez que ele entra em ação ou não tem como entrar, vira uma linha de log.
 *
 * Nunca lança: cleanup é sempre chamado em caminho de erro.
 */
export const cleanupBrowser = async (
	browser: BrowserInstance,
): Promise<void> => {
	const pid = await resolveBrowserPid(browser);
	const tree = pid !== undefined ? await descendantsOf(pid) : [];

	// Fechar as páginas antes evita que um `beforeunload` trave o close().
	await settleWithin(
		browser
			.pages()
			.then((pages) => Promise.all(pages.map((page) => page.close()))),
		closeTimeoutMs(),
	);

	const closing = await settleWithin(browser.close(), closeTimeoutMs());
	const closeOutcome = {
		resolved: "finished",
		rejected: "failed",
		timeout: `timed out after ${closeTimeoutMs()}ms`,
	}[closing];

	if (pid === undefined) {
		if (closing !== "resolved") {
			console.warn(
				`⚠️ [BROWSER] close() ${closeOutcome} and the Chromium pid could not be resolved — the process may stay alive.`,
			);
		}
		return;
	}

	// Quem ficou de pé: o snapshot inicial, o pid, e filhos nascidos depois dele.
	const candidates = new Set([...tree, ...(await descendantsOf(pid)), pid]);
	const survivors = [...candidates].filter(isAlive);
	if (survivors.length === 0) return;

	console.warn(
		`⚠️ [BROWSER] Graceful close ${closeOutcome} but ${survivors.length} process(es) of Chromium ${pid} survived. Sending SIGTERM.`,
	);

	for (const target of survivors) killPid(target, "SIGTERM");
	await Promise.all(
		survivors.map((target) => waitForExit(target, killGraceMs())),
	);

	const stubborn = survivors.filter(isAlive);
	if (stubborn.length > 0) {
		console.warn(
			`⚠️ [BROWSER] ${stubborn.length} process(es) ignored SIGTERM for ${killGraceMs()}ms. Sending SIGKILL.`,
		);
	}
	for (const target of stubborn) killPid(target, "SIGKILL");
};

export type SharedSession = Awaited<ReturnType<typeof initializeBrowser>>;
