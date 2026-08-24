import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageWithCursor } from "puppeteer-real-browser";
import { delay } from "@/helpers/utils.js";

/** Página mínima que o solver precisa — permite testar sem browser real. */
export type ChallengeAwarePage = Pick<PageWithCursor, "content" | "url"> &
	Partial<Pick<PageWithCursor, "screenshot">>;

/**
 * O que a página é neste instante.
 * - `blocked`: bloqueio definitivo, esperar não resolve
 * - `challenge`: interstitial em andamento
 * - `too-short`: documento transitório do redirect, ainda não é a página
 * - `ready`: parece a página real
 */
export type PageState = "blocked" | "challenge" | "too-short" | "ready";

/** Por que a leitura não foi aceita. `unstable` = válida, mas sem confirmação. */
export type SettleRejectReason = Exclude<PageState, "ready"> | "unstable";

export type CloudflareFailureReason = "blocked" | "timeout";

// ---------------------------------------------------------------------------
// PageSnapshot — uma leitura da página e o que dá pra afirmar sobre ela
// ---------------------------------------------------------------------------

/**
 * Um instante da página. Concentra todo o conhecimento sobre "como a Cloudflare
 * se parece no HTML", para que o solver só precise perguntar `state`.
 */
export class PageSnapshot {
	/**
	 * Marcadores da interstitial. Todos precisam ser **exclusivos** da página de
	 * desafio: `challenge-platform` não serve, a Cloudflare injeta esse script
	 * (`/cdn-cgi/challenge-platform/.../jsd/...`) também em páginas normais, e
	 * usá-lo fazia a página legítima ser lida como desafio para sempre.
	 */
	private static readonly CHALLENGE_MARKERS: readonly RegExp[] = [
		/<title[^>]*>\s*just a moment/i,
		/_cf_chl_opt/i,
		/id="challenge-(form|running|stage|error-title)"/i,
		/verifying you are human/i,
		/enable javascript and cookies to continue/i,
	];

	/** Bloqueio definitivo (1020, WAF): falhar na hora em vez de esperar à toa. */
	private static readonly BLOCK_MARKERS: readonly RegExp[] = [
		/attention required!\s*\|\s*cloudflare/i,
		/sorry, you have been blocked/i,
		/error code:\s*10\d\d/i,
	];

	/**
	 * Ao sair do desafio a Cloudflare redireciona, e existe uma janela em que o
	 * documento é um `<html><head></head><body></body></html>` vazio: não é mais
	 * desafio, mas também não é a página. Abaixo deste tamanho, não conta.
	 */
	static readonly MIN_REAL_PAGE_LENGTH = 1_024;

	constructor(
		readonly html: string,
		readonly url: string,
	) {}

	/** Leitura que falhou (contexto de execução destruído durante o redirect). */
	static unreadable(url: string): PageSnapshot {
		return new PageSnapshot("", url);
	}

	get isEmpty(): boolean {
		return this.html.length === 0;
	}

	get title(): string | null {
		return (
			this.html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? null
		);
	}

	get isChallenge(): boolean {
		return PageSnapshot.CHALLENGE_MARKERS.some((m) => m.test(this.html));
	}

	get isBlocked(): boolean {
		return PageSnapshot.BLOCK_MARKERS.some((m) => m.test(this.html));
	}

	state(minLength = PageSnapshot.MIN_REAL_PAGE_LENGTH): PageState {
		if (this.isBlocked) return "blocked";
		if (this.isChallenge) return "challenge";
		return this.html.length >= minLength ? "ready" : "too-short";
	}
}

// ---------------------------------------------------------------------------
// ChallengeWatch — o que a página fez ao longo da espera
// ---------------------------------------------------------------------------

/**
 * Diagnóstico acumulado. Responde a pergunta que o erro sozinho não responde:
 * a página ficou congelada (JS do desafio nunca rodou), ficou em loop de
 * redirect, ou já era a página real e o solver é que não a aceitou?
 */
export type CloudflareChallengeDetails = {
	/** Quantas leituras de HTML foram feitas. */
	attempts: number;
	elapsedMs: number;
	/** URLs distintas observadas, em ordem. Mais de uma = redirect/loop. */
	urls: string[];
	/** `false` = HTML idêntico do começo ao fim, forte indício de JS parado. */
	htmlChanged: boolean;
	lastTitle: string | null;
	lastHtmlLength: number;
	/** Motivo da última rejeição — diz exatamente onde o loop ficou preso. */
	lastRejectReason: SettleRejectReason | null;
	/** Dump em disco, se `CLOUDFLARE_DEBUG_DIR` estiver setado. */
	dumpPath?: string;
};

class ChallengeWatch {
	private static readonly MAX_TRACKED_URLS = 10;

	private readonly startedAt = Date.now();
	private readonly urlTrail: string[] = [];
	private attempts = 0;
	private firstHtml: string | null = null;
	private last = PageSnapshot.unreadable("unknown");
	private rejectReason: SettleRejectReason | null = "challenge";

	record(snapshot: PageSnapshot, reason: SettleRejectReason | null): void {
		this.attempts += 1;
		this.rejectReason = reason;
		this.trackUrl(snapshot.url);

		if (snapshot.isEmpty) return;
		this.firstHtml ??= snapshot.html;
		this.last = snapshot;
	}

	get elapsedMs(): number {
		return Date.now() - this.startedAt;
	}

	get lastSnapshot(): PageSnapshot {
		return this.last;
	}

	/** Uma linha legível em log — mesma fonte de verdade do erro e do progresso. */
	get summary(): string {
		const seconds = (this.elapsedMs / 1000).toFixed(1);
		const movement = this.htmlChanged ? "HTML mudou" : "HTML estático";
		const redirects =
			this.urlTrail.length > 1 ? `, ${this.urlTrail.length} URLs` : "";
		const stuck = this.rejectReason ? `, preso em ${this.rejectReason}` : "";
		return `${seconds}s, ${this.attempts} leituras, ${movement}${redirects}${stuck}, título ${JSON.stringify(this.last.title)}`;
	}

	details(dumpPath?: string): CloudflareChallengeDetails {
		return {
			attempts: this.attempts,
			elapsedMs: this.elapsedMs,
			urls: [...this.urlTrail],
			htmlChanged: this.htmlChanged,
			lastTitle: this.last.title,
			lastHtmlLength: this.last.html.length,
			lastRejectReason: this.rejectReason,
			dumpPath,
		};
	}

	private get htmlChanged(): boolean {
		return this.firstHtml !== null && this.firstHtml !== this.last.html;
	}

	private trackUrl(url: string): void {
		if (this.urlTrail.at(-1) === url) return;
		// No limite, sobrescreve a última posição: a URL mais recente é a mais
		// informativa, e perdê-la esvaziaria o diagnóstico de redirect loop.
		if (this.urlTrail.length < ChallengeWatch.MAX_TRACKED_URLS) {
			this.urlTrail.push(url);
		} else {
			this.urlTrail[this.urlTrail.length - 1] = url;
		}
	}
}

// ---------------------------------------------------------------------------
// Erro
// ---------------------------------------------------------------------------

export class CloudflareChallengeError extends Error {
	constructor(
		readonly url: string,
		readonly reason: CloudflareFailureReason,
		readonly details?: CloudflareChallengeDetails,
		summary?: string,
	) {
		const base =
			reason === "blocked"
				? `Cloudflare bloqueou o acesso a ${url}`
				: `Desafio da Cloudflare não foi resolvido a tempo em ${url}`;
		super(summary ? `${base} (${summary})` : base);
		this.name = "CloudflareChallengeError";
	}
}

// ---------------------------------------------------------------------------
// Solver — o loop de espera
// ---------------------------------------------------------------------------

export type SolverOptions = {
	timeoutMs?: number;
	pollIntervalMs?: number;
	progressIntervalMs?: number;
	/** Tamanho mínimo para o HTML contar como página de verdade. */
	minHtmlLength?: number;
	/** Leituras `ready` consecutivas exigidas antes de aceitar. */
	stableReads?: number;
};

/** Erros que significam browser morto — insistir por 45s não adianta. */
const FATAL_BROWSER_ERROR =
	/target closed|session closed|protocol error|browser has disconnected/i;

/**
 * Aguarda o desafio da Cloudflare sair do caminho e devolve o HTML resolvido.
 *
 * Use quando o HTML atual for um desafio: o `page.goto` retorna no
 * `domcontentloaded` da interstitial (403 + `cf-mitigated: challenge`)
 * enquanto o solver do `turnstile: true` ainda está trabalhando.
 */
export class CloudflareChallengeSolver {
	private static readonly DEFAULT_TIMEOUT_MS = 45_000;
	private static readonly DEFAULT_POLL_INTERVAL_MS = 500;
	private static readonly DEFAULT_PROGRESS_INTERVAL_MS = 10_000;
	private static readonly DEFAULT_STABLE_READS = 2;

	private readonly timeoutMs: number;
	private readonly pollIntervalMs: number;
	private readonly progressIntervalMs: number;
	private readonly minHtmlLength: number;
	private readonly stableReads: number;

	private readonly watch = new ChallengeWatch();
	private settledReads = 0;

	constructor(
		private readonly page: ChallengeAwarePage,
		options: SolverOptions = {},
	) {
		this.timeoutMs =
			options.timeoutMs ?? CloudflareChallengeSolver.defaultTimeoutMs();
		this.pollIntervalMs =
			options.pollIntervalMs ??
			CloudflareChallengeSolver.DEFAULT_POLL_INTERVAL_MS;
		this.progressIntervalMs =
			options.progressIntervalMs ??
			CloudflareChallengeSolver.DEFAULT_PROGRESS_INTERVAL_MS;
		this.minHtmlLength =
			options.minHtmlLength ?? PageSnapshot.MIN_REAL_PAGE_LENGTH;
		this.stableReads =
			options.stableReads ?? CloudflareChallengeSolver.DEFAULT_STABLE_READS;
	}

	/** Timeout padrão, configurável via `CLOUDFLARE_CHALLENGE_TIMEOUT_MS`. */
	static defaultTimeoutMs(): number {
		const n = Number(process.env.CLOUDFLARE_CHALLENGE_TIMEOUT_MS);
		return Number.isFinite(n) && n > 0
			? n
			: CloudflareChallengeSolver.DEFAULT_TIMEOUT_MS;
	}

	/**
	 * @returns o HTML da página já livre do desafio.
	 * @throws {CloudflareChallengeError} bloqueio definitivo ou estouro de tempo,
	 *   sempre com `details` explicando o que a página fez durante a espera.
	 */
	async resolve(): Promise<string> {
		const deadline = Date.now() + this.timeoutMs;
		let nextProgressAt = Date.now() + this.progressIntervalMs;

		while (Date.now() < deadline) {
			const snapshot = await this.read();
			const state = snapshot.state(this.minHtmlLength);

			this.settledReads = state === "ready" ? this.settledReads + 1 : 0;
			const settled = this.settledReads >= this.stableReads;
			this.watch.record(snapshot, settled ? null : this.rejectReason(state));

			if (state === "blocked") throw await this.fail("blocked");
			if (settled) return snapshot.html;

			if (Date.now() >= nextProgressAt) {
				nextProgressAt += this.progressIntervalMs;
				console.warn(`⏳ [CLOUDFLARE] no desafio — ${this.watch.summary}`);
			}

			await delay(this.pollIntervalMs);
		}

		throw await this.fail("timeout");
	}

	private rejectReason(state: PageState): SettleRejectReason {
		return state === "ready" ? "unstable" : state;
	}

	/**
	 * Uma leitura tolerante: o contexto de execução morre a cada redirect do
	 * desafio, o que é esperado. Browser morto, porém, propaga imediatamente.
	 */
	private async read(): Promise<PageSnapshot> {
		const url = this.currentUrl();
		try {
			return new PageSnapshot(await this.page.content(), url);
		} catch (error) {
			if (error instanceof Error && FATAL_BROWSER_ERROR.test(error.message)) {
				throw error;
			}
			return PageSnapshot.unreadable(url);
		}
	}

	private currentUrl(): string {
		try {
			return this.page.url();
		} catch {
			return "unknown";
		}
	}

	private async fail(
		reason: CloudflareFailureReason,
	): Promise<CloudflareChallengeError> {
		const dumpPath = await this.dump();
		return new CloudflareChallengeError(
			this.currentUrl(),
			reason,
			this.watch.details(dumpPath),
			this.watch.summary,
		);
	}

	/**
	 * Grava HTML + screenshot do estado final quando `CLOUDFLARE_DEBUG_DIR` está
	 * setado. Um screenshot responde na hora se o widget do turnstile sequer
	 * renderizou — coisa que nenhum log de texto mostra.
	 */
	private async dump(): Promise<string | undefined> {
		const dir = process.env.CLOUDFLARE_DEBUG_DIR?.trim();
		if (!dir) return undefined;

		try {
			await mkdir(dir, { recursive: true });
			const stamp = new Date().toISOString().replace(/[:.]/g, "-");
			const base = join(dir, `cloudflare-${stamp}`);

			await writeFile(`${base}.html`, this.watch.lastSnapshot.html, "utf8");
			if (typeof this.page.screenshot === "function") {
				await this.page.screenshot({ path: `${base}.png`, fullPage: true });
			}
			return base;
		} catch (error) {
			console.warn(
				"⚠️ [CLOUDFLARE] Falha ao gravar dump de diagnóstico:",
				error,
			);
			return undefined;
		}
	}
}
