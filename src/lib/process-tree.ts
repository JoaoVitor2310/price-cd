/**
 * Árvore de processos — o que o `kill` de um pid só não alcança.
 *
 * Chromium não é um processo: o processo principal é pai de um renderer por
 * aba, de um GPU process e do zygote. Matar só o pai deixa os filhos vivos e
 * reparentados para o `init` — foi assim que a VPS acumulou dezenas de Chromium
 * até estourar os 8 GB (ver `docs/IMPROVEMENTS.md`, item do vazamento).
 *
 * A leitura da árvore é feita pelo `/proc` (Linux/Docker, que é onde o serviço
 * roda). Em qualquer plataforma sem procfs a tabela volta vazia e o chamador
 * degrada para "mata só o pid que eu conheço" — nunca lança.
 */
import { readdir, readFile } from "node:fs/promises";

export interface ProcessEntry {
	pid: number;
	ppid: number;
}

/** Sinais que usamos; `0` é o probe de "está vivo?" do POSIX. */
export type KillSignal = NodeJS.Signals | 0;

/**
 * Lê `/proc` e devolve os pares pid/ppid de todos os processos visíveis.
 * Processos que morrem no meio da varredura são simplesmente ignorados.
 */
export const readProcessTable = async (): Promise<ProcessEntry[]> => {
	let entries: string[];
	try {
		entries = await readdir("/proc");
	} catch {
		return [];
	}

	const table: ProcessEntry[] = [];

	await Promise.all(
		entries.map(async (entry) => {
			const pid = Number(entry);
			if (!Number.isInteger(pid) || pid <= 0) return;

			try {
				const stat = await readFile(`/proc/${pid}/stat`, "utf8");
				const ppid = parsePpid(stat);
				if (ppid !== null) table.push({ pid, ppid });
			} catch {
				// processo morreu entre o readdir e o readFile — ignora
			}
		}),
	);

	return table;
};

/**
 * Extrai o ppid de uma linha de `/proc/<pid>/stat`.
 *
 * O campo 2 é o nome do executável entre parênteses e pode conter espaços e
 * parênteses (`(Web Content)`), então o parse começa no ÚLTIMO `)`.
 * Layout: `pid (comm) state ppid ...`
 */
const parsePpid = (stat: string): number | null => {
	const end = stat.lastIndexOf(")");
	if (end === -1) return null;

	const fields = stat
		.slice(end + 1)
		.trim()
		.split(/\s+/);
	const ppid = Number(fields[1]); // [0] = state, [1] = ppid
	return Number.isInteger(ppid) ? ppid : null;
};

/**
 * Acha o processo PRINCIPAL do Chromium que escuta na porta de debug `port`.
 *
 * Existe porque `browser.process()` devolve `null` para browsers criados por
 * `puppeteer.connect` — e o `puppeteer-real-browser` sempre conecta. Sem o pid, o
 * `cleanupBrowser` não tem de onde partir para tirar a árvore; foi assim que
 * sessões velhas ficaram vivas por dias (produção, 2026-10-10). A porta, ao
 * contrário, está sempre na `wsEndpoint()`.
 *
 * Os renderers herdam `--remote-debugging-port` na linha de comando; o que os
 * distingue do principal é o `--type=`. Compara o argumento INTEIRO: `4661` não
 * pode casar com `46611`.
 *
 * Se mais de um processo casar (um wrapper que não faz `exec` e o Chromium que ele
 * lança, ambos com a flag e sem `--type=`), vale o de MENOR pid: o pai nasce antes
 * do filho, e a árvore do pai contém o Chromium, então o snapshot e o kill
 * alcançam os dois. Escolher "o último que terminou a varredura" dependeria da
 * ordem do `Promise.all` — não determinístico, e errar o pid reabre o vazamento.
 *
 * Devolve `undefined` se não achar (inclusive onde não há procfs) — nunca lança.
 */
export const findPidByDebugPort = async (
	port: number,
): Promise<number | undefined> => {
	let entries: string[];
	try {
		entries = await readdir("/proc");
	} catch {
		return undefined;
	}

	const wanted = `--remote-debugging-port=${port}`;
	const matches: number[] = [];

	await Promise.all(
		entries.map(async (entry) => {
			const pid = Number(entry);
			if (!Number.isInteger(pid) || pid <= 0) return;

			try {
				// cmdline separa os argumentos por NUL.
				const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split(
					"\0",
				);
				if (args.includes(wanted) && !args.some((a) => a.startsWith("--type="))) {
					matches.push(pid);
				}
			} catch {
				// processo morreu entre o readdir e o readFile — ignora
			}
		}),
	);

	return matches.length > 0 ? Math.min(...matches) : undefined;
};

/**
 * Todos os descendentes de `root` na tabela, dos mais profundos para os mais
 * rasos — a ordem em que se deve matar, para que nenhum nível seja reparentado
 * antes de ter sido visitado. O próprio `root` não entra no resultado.
 */
export const collectDescendants = (
	root: number,
	table: ProcessEntry[],
): number[] => {
	const childrenOf = new Map<number, number[]>();
	for (const { pid, ppid } of table) {
		const siblings = childrenOf.get(ppid);
		if (siblings) siblings.push(pid);
		else childrenOf.set(ppid, [pid]);
	}

	const byDepth: number[] = [];
	const seen = new Set<number>([root]);
	let frontier = [root];

	// BFS por nível; `seen` também protege contra ciclos em tabelas corrompidas.
	while (frontier.length > 0) {
		const next: number[] = [];
		for (const pid of frontier) {
			for (const child of childrenOf.get(pid) ?? []) {
				if (seen.has(child)) continue;
				seen.add(child);
				next.push(child);
			}
		}
		byDepth.push(...next);
		frontier = next;
	}

	return byDepth.reverse();
};

/** Descendentes vivos de `pid` agora, dos mais profundos para os mais rasos. */
export const descendantsOf = async (pid: number): Promise<number[]> =>
	collectDescendants(pid, await readProcessTable());

/**
 * `true` se o pid existe. `EPERM` também significa vivo (existe, mas não é
 * nosso para sinalizar); só `ESRCH` prova que o processo se foi.
 */
export const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** Envia o sinal e engole o erro se o processo já morreu (ESRCH) ou não é nosso. */
export const killPid = (pid: number, signal: KillSignal): void => {
	try {
		process.kill(pid, signal);
	} catch {
		// já morreu ou sem permissão — nada a fazer
	}
};

/**
 * Sinaliza `pid` e toda a sua descendência, dos processos mais profundos para
 * o pai. Devolve os pids que receberam o sinal.
 */
export const killProcessTree = async (
	pid: number,
	signal: NodeJS.Signals,
): Promise<number[]> => {
	const targets = [...(await descendantsOf(pid)), pid];
	for (const target of targets) killPid(target, signal);
	return targets;
};
