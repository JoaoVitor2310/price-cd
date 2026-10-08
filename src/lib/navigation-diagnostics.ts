import type { PageWithCursor } from "puppeteer-real-browser";
import { type PageState, PageSnapshot } from "@/lib/puppeteer-cloudflare.js";

/** Página mínima necessária para o diagnóstico — permite testar sem browser real. */
export type DiagnosablePage = Pick<PageWithCursor, "content" | "url">;

/**
 * O que a página era quando a navegação desistiu. Separa as três hipóteses que um
 * `TimeoutError` sozinho não distingue:
 * - `unresponsive`: nem `content()` respondeu — Chromium travado;
 * - `unreadable`: a leitura lançou — Chromium morto ("Target closed", "Session closed");
 * - `page`: a página responde, e `state` diz se é desafio/bloqueio da Cloudflare ou
 *   conteúdo real (site lento, não bloqueado).
 */
export type NavigationDiagnosis =
	| { kind: "unresponsive"; waitedMs: number }
	| { kind: "unreadable"; error: string }
	| {
			kind: "page";
			state: PageState;
			url: string;
			title: string | null;
			htmlLength: number;
	  };

export const DEFAULT_DIAGNOSIS_TIMEOUT_MS = 3_000;

/**
 * Lê o estado da página sem nunca lançar nem travar. É chamada justamente quando
 * algo já deu errado, então o próprio diagnóstico não pode virar um segundo
 * problema: `content()` num renderer pendurado nunca resolve, daí a corrida
 * contra o timeout.
 */
export async function diagnoseFailedNavigation(
	page: DiagnosablePage,
	timeoutMs = DEFAULT_DIAGNOSIS_TIMEOUT_MS,
): Promise<NavigationDiagnosis> {
	const TIMED_OUT = Symbol("timed-out");
	let timer: ReturnType<typeof setTimeout> | undefined;

	try {
		const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
			timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
		});

		const html = await Promise.race([page.content(), timeout]);
		if (html === TIMED_OUT) return { kind: "unresponsive", waitedMs: timeoutMs };

		const snapshot = new PageSnapshot(html, page.url());
		return {
			kind: "page",
			state: snapshot.state(),
			url: snapshot.url,
			title: snapshot.title,
			htmlLength: html.length,
		};
	} catch (error) {
		return {
			kind: "unreadable",
			error: error instanceof Error ? error.message : String(error),
		};
	} finally {
		clearTimeout(timer);
	}
}

/** Uma linha de log que já traz a leitura do diagnóstico, não só os dados crus. */
export function describeDiagnosis(diagnosis: NavigationDiagnosis): string {
	switch (diagnosis.kind) {
		case "unresponsive":
			return `browser unresponsive: page.content() did not answer within ${diagnosis.waitedMs}ms (Chromium hung)`;
		case "unreadable":
			return `browser unreadable: ${diagnosis.error} (Chromium likely dead)`;
		case "page": {
			const where = `url=${diagnosis.url} title=${JSON.stringify(diagnosis.title)} html=${diagnosis.htmlLength} chars`;
			const reading: Record<PageState, string> = {
				blocked: "blocked by Cloudflare",
				challenge: "stuck on a Cloudflare challenge",
				"too-short": "empty or transitional document",
				ready: "real content present — site slow rather than blocked",
			};
			return `page responds, ${reading[diagnosis.state]} (${where})`;
		}
	}
}
