import {
	cleanupBrowser,
	initializeBrowser,
	type SharedSession,
} from "@/lib/puppeteer-browser.js";

/**
 * A sessão de Chromium compartilhada do AllKeyShop, com dono explícito.
 *
 * Antes isto era estado mutável de módulo (`let _session`, `let _queue`,
 * `let _generation`) — singleton por acidente de import, sem ninguém
 * responsável por desligá-lo. Num processo que já derrubou a VPS por Chromium
 * vazado (2026-08-24), "sem dono" é o problema, não detalhe de estilo.
 *
 * Nada do comportamento mudou: geração, reciclagem por idade, health check e
 * fila continuam exatamente como estavam. O que mudou é que agora existe um
 * objeto para o container desligar (`OnApplicationShutdown`) e para um teste
 * instanciar isoladamente.
 */
export class SharedBrowserSession {
	private session: SharedSession | null = null;
	private opening: Promise<SharedSession> | null = null;
	private openedAt = 0;
	private queue: Promise<unknown> = Promise.resolve();

	/**
	 * Incrementado a cada invalidação. Uma sessão que estava nascendo enquanto a
	 * anterior era invalidada tem geração velha: é fechada em vez de publicada,
	 * senão o browser tardio sobrescreveria a referência e vazaria.
	 */
	private generation = 0;

	constructor(private readonly maxAgeMs: () => number) {}

	async get(): Promise<SharedSession> {
		if (this.session) {
			try {
				await this.session.browser.pages(); // lança se o processo morreu
				// Reciclagem preventiva: um Chromium de horas acumula memória, e
				// quanto mais velho fica, mais perto do OOM a máquina chega.
				if (!this.isExpired()) return this.session;
				await this.invalidate();
			} catch {
				// Browser morto — o cleanup ainda é obrigatório: quando o OOM killer
				// mata só um renderer, o resto da árvore continua vivo e órfão.
				await this.invalidate();
			}
		}

		if (!this.opening) this.opening = this.open();
		return this.opening;
	}

	/**
	 * Descarta a sessão **fechando** o browser antes de zerar as referências.
	 * Zerar sem fechar era o vazamento: cada falha de scraping abandonava um
	 * Chromium vivo e a chamada seguinte subia outro.
	 */
	async invalidate(): Promise<void> {
		this.generation++;

		const session = this.session;
		const pending = this.opening;
		this.session = null;
		this.opening = null;
		this.openedAt = 0;

		if (session) await cleanupBrowser(session.browser);
		// Sessão em voo: `open` fecha o browser tardio por causa da geração.
		if (pending) await pending.catch(() => {});
	}

	/** Serializa tarefas que precisam do browser. Falha não trava a fila. */
	enqueue<T>(task: () => Promise<T>): Promise<T> {
		const result = this.queue.then(
			() => task(),
			() => task(),
		) as Promise<T>;
		this.queue = result.then(
			() => {},
			() => {},
		);
		return result;
	}

	private isExpired(): boolean {
		const maxAge = this.maxAgeMs();
		return maxAge > 0 && Date.now() - this.openedAt > maxAge;
	}

	private open(): Promise<SharedSession> {
		const generation = this.generation;

		return initializeBrowser().then(
			async (session) => {
				if (generation !== this.generation) {
					await cleanupBrowser(session.browser);
					throw new Error("Shared browser session was invalidated while opening");
				}
				this.session = session;
				this.opening = null;
				this.openedAt = Date.now();
				return session;
			},
			(error) => {
				if (generation === this.generation) this.opening = null;
				throw error;
			},
		);
	}
}
