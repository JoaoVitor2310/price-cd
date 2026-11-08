import { DelayedError } from "bullmq";
import type {
	BullmqJob,
	BullmqJobProcessor,
	BullmqWorkerClient,
} from "@/infrastructure/background/bullmq-clients.js";
import { errorMessage } from "@/lib/error-message.js";
import { withTimeout } from "@/lib/with-timeout.js";

/**
 * O consumidor de uma fila de jobs **longos**, que o desligamento devolve à fila
 * em vez de esperar. Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * É a parte da fila da pesquisa que não sabe nada de pesquisa: qualquer fluxo
 * cujo job leva minutos e usa o Chromium (a pesquisa, e depois o Reabastecimento
 * e a Descoberta — item 9 do `docs/IMPROVEMENTS.md`) precisa da mesma parada
 * ordenada, e ela é sutil demais para existir em mais de uma cópia.
 *
 * Não é provider do Nest: o adapter da fila é, e chama `start` e `stop` nos
 * hooks dele. O Nest só chama hook de ciclo de vida em provider, e a fila é que
 * sabe o que o job significa.
 *
 * A fila de webhooks **não** usa isto: entregar leva segundos, e lá o
 * desligamento espera a entrega terminar.
 */

/**
 * Executa um job. O sinal é abortado no desligamento, **antes** de o job voltar
 * à fila: quem executa deve parar antes de qualquer efeito que não possa repetir
 * (chamar o Estoque, comentar no SteamTrades).
 */
export type ResumableJobHandler = (
	job: BullmqJob,
	signal: AbortSignal,
) => Promise<void>;

export type ResumableBullmqWorkerOptions = {
	/** Nome do job nos logs: "research" vira "Research job 42". */
	label: string;
	/** Prefixo dos logs, como `[QUEUE]`. */
	tag: string;
	/** Ícone das linhas informativas da fila, como `📥`; aviso e erro usam ⚠️ e ❌. */
	icon: string;
	createWorker: (processor: BullmqJobProcessor) => BullmqWorkerClient;
	handle: ResumableJobHandler;
};

/**
 * Quanto o desligamento espera o que foi registrado em `trackUntilShutdown`. O
 * normal é levar milissegundos; com o Redis fora, esperar mais não salva nada e
 * só come o `stop_grace_period`, que os browsers também precisam.
 */
export const TRACKED_WORK_DRAIN_TIMEOUT_MS = 10_000;

type ActiveJob = {
	job: BullmqJob;
	token?: string;
	returned: boolean;
	/**
	 * Abortado no desligamento: quem executa para antes do efeito que não pode
	 * repetir, e a falha vira `DelayedError` — sem evento `failed`.
	 */
	cancellation: AbortController;
};

export class ResumableBullmqWorker {
	private readonly worker: BullmqWorkerClient;
	private active: ActiveJob | undefined;
	private shuttingDown = false;
	/** Trabalho em andamento que o desligamento espera (o aviso de `failed`). */
	private readonly tracked = new Set<Promise<void>>();

	constructor(private readonly options: ResumableBullmqWorkerOptions) {
		this.worker = options.createWorker((job, token) =>
			this.process(job, token),
		);
	}

	/**
	 * Para o `onApplicationBootstrap` do adapter: começa a consumir só quando o
	 * container inteiro está de pé, senão um job pegaria dependências ainda não
	 * inicializadas.
	 */
	start(): void {
		this.worker.run().catch((error) => {
			console.error(
				`❌ ${this.options.tag} ${capitalize(this.options.label)} worker stopped:`,
				error,
			);
		});
	}

	/**
	 * Para o `beforeApplicationShutdown` do adapter: para de consumir **antes** de
	 * os browsers fecharem, porque o Nest chama todos os `beforeApplicationShutdown`
	 * antes de qualquer `onApplicationShutdown`, que é onde o `BrowserShutdown`
	 * fecha o Chromium.
	 *
	 * O job em andamento volta para a fila (`moveToDelayed` com delay zero), sem
	 * consumir tentativa, e roda inteiro de novo quando o serviço subir: um job
	 * leva minutos e o `stop_grace_period` não espera isso. Se a devolução falhar
	 * (Redis fora), o lock expira e o próximo worker o recupera como travado —
	 * mais lento, mesmo resultado.
	 *
	 * `close(true)` não espera o processador terminar. Fechar o browser não
	 * necessariamente derruba o job por si só; é o sinal abortado que o para, e o
	 * `process` traduz essa falha em `DelayedError` para a BullMQ não marcar o job
	 * como falho. Se o efeito irrepetível já estava em curso quando o sinal veio,
	 * ele acontece e o job roda de novo: janela que só a idempotência do outro
	 * lado fecha.
	 */
	async stop(): Promise<void> {
		this.shuttingDown = true;

		const active = this.active;
		if (active) {
			// Antes da devolução: o que falhar daqui em diante é do desligamento.
			active.cancellation.abort();
			try {
				await active.job.moveToDelayed(Date.now(), active.token);
				active.returned = true;
				console.log(
					`${this.options.icon} ${this.options.tag} ${this.jobName(active.job)} returned to the queue — it runs again on the next boot.`,
				);
			} catch (error) {
				console.warn(
					`⚠️ ${this.options.tag} Could not return ${this.options.label} job ${active.job.id} to the queue (${errorMessage(error)}) — it will be recovered as stalled.`,
				);
			}
		}

		try {
			await this.worker.close(true);
		} catch (error) {
			console.warn(
				`⚠️ ${this.options.tag} Failed to close the ${this.options.label} worker: ${errorMessage(error)}`,
			);
		}

		// Depois do worker fechado, nada novo é registrado.
		await this.drainTracked();
	}

	/**
	 * Registra trabalho que o desligamento deve esperar, até
	 * `TRACKED_WORK_DRAIN_TIMEOUT_MS`. Devolve uma promessa que **nunca rejeita**:
	 * uma rejeição aqui seria uma rejeição sem handler, que derruba o processo no
	 * Node 22 — no meio do desligamento, antes de os browsers fecharem. Quem
	 * registra deve tratar o próprio erro; o `catch` daqui é a rede de segurança.
	 */
	trackUntilShutdown(work: Promise<void>): Promise<void> {
		const settled = work.catch((error) => {
			console.error(
				`❌ ${this.options.tag} Work tracked by the ${this.options.label} worker failed:`,
				error,
			);
		});
		this.tracked.add(settled);
		void settled.finally(() => this.tracked.delete(settled));
		return settled;
	}

	private async drainTracked(): Promise<void> {
		if (this.tracked.size === 0) return;
		try {
			await withTimeout(
				// `allSettled`: espera todos até o teto, mesmo que um falhe.
				Promise.allSettled(this.tracked),
				TRACKED_WORK_DRAIN_TIMEOUT_MS,
			);
		} catch {
			console.warn(
				`⚠️ ${this.options.tag} ${this.tracked.size} task(s) tracked by the ${this.options.label} worker still pending at shutdown — they may be lost.`,
			);
		}
	}

	private async process(job: BullmqJob, token?: string): Promise<void> {
		// Pego no instante do desligamento — entre o `shuttingDown = true` e o
		// `close(true)` o worker ainda busca job. Rodar seria começar um job que o
		// browser fechando vai derrubar; devolve na hora, sem consumir tentativa.
		// Se a devolução falhar, `DelayedError` deixa o job ativo e ele volta como
		// travado.
		if (this.shuttingDown) {
			await job
				.moveToDelayed(Date.now(), token)
				.catch((error) =>
					console.warn(
						`⚠️ ${this.options.tag} Could not return ${this.options.label} job ${job.id} picked during shutdown (${errorMessage(error)}) — it will be recovered as stalled.`,
					),
				);
			throw new DelayedError();
		}

		const active: ActiveJob = {
			job,
			token,
			returned: false,
			cancellation: new AbortController(),
		};
		this.active = active;

		let outcome: { ok: true } | { ok: false; error: unknown };
		try {
			await this.options.handle(job, active.cancellation.signal);
			outcome = { ok: true };
		} catch (error) {
			outcome = { ok: false, error };
		} finally {
			this.active = undefined;
		}

		if (outcome.ok) {
			if (!active.returned) return;
			// Terminou depois de ter sido devolvido à fila: vai rodar de novo.
			// `DelayedError` diz à BullMQ que o job já foi movido e não deve ser
			// tocado.
			console.warn(
				`⚠️ ${this.options.tag} ${this.jobName(job)} finished during shutdown, after being returned to the queue — it will run again.`,
			);
			throw new DelayedError();
		}

		// Durante o desligamento a falha é do próprio desligamento (browser
		// fechado), não do job: devolvido, o job fica onde está; não devolvido,
		// fica ativo e volta como travado. Os dois rodam de novo.
		if (this.shuttingDown) throw new DelayedError();
		throw outcome.error;
	}

	private jobName(job: BullmqJob): string {
		return `${capitalize(this.options.label)} job ${job.id}`;
	}
}

const capitalize = (text: string): string =>
	text.charAt(0).toUpperCase() + text.slice(1);
