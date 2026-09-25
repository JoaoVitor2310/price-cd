import { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import type { SharedSession } from "@/lib/puppeteer-browser.js";

/** Idade máxima da sessão; 0 desliga a reciclagem. Default: 30 min. */
function sessionMaxAgeMs(): number {
	const value = Number(process.env.BROWSER_SESSION_MAX_AGE_MS);
	if (Number.isFinite(value) && value >= 0) return value;
	return 30 * 60 * 1000;
}

/**
 * As instâncias que o processo inteiro usa.
 *
 * **Uma só por processo, e isso não é opcional.** Durante a coexistência
 * Express/Nest os dois apps chegam aqui; se o container do Nest criasse as suas
 * próprias com `useClass`, existiriam dois gerenciadores de Chromium num
 * container com `mem_limit: 2g`. Por isso o `BrowserModule` registra estas
 * instâncias com `useValue` — ver `docs/nest-conceitos.md` §4.
 *
 * Este arquivo vive em `infrastructure/browser/` e **não** em `lib/` por uma
 * razão concreta: `lib/puppeteer-browser.ts` é a folha que sabe abrir e fechar
 * um Chromium, e as classes de sessão dependem dela. Colocar os singletons lá
 * fechava um ciclo de import — e o sintoma era `SharedBrowserSession is not a
 * constructor`, dependendo da ordem em que os módulos fossem carregados.
 *
 * No PR 10, com o Express fora, isto pode virar `useClass` no módulo e o
 * singleton desaparece.
 */
export const sharedBrowserSession = new SharedBrowserSession(sessionMaxAgeMs);
export const suppliersBrowserSession = new SuppliersBrowserSession();

// ---------------------------------------------------------------------------
// Fachadas finas sobre as instâncias acima.
//
// Existem para não reescrever todos os call sites de uma vez — o PR 6 troca o
// dono do estado, não os chamadores. Somem no PR 10, junto com o Express.
// ---------------------------------------------------------------------------

export const getSharedSession = (): Promise<SharedSession> =>
	sharedBrowserSession.get();

/**
 * O chamador precisa dar `await` antes de propagar o erro — do contrário o
 * cleanup corre solto e o próximo browser nasce antes de o anterior morrer.
 */
export const invalidateSharedSession = (): Promise<void> =>
	sharedBrowserSession.invalidate();

export const enqueueWithBrowser = <T>(task: () => Promise<T>): Promise<T> =>
	sharedBrowserSession.enqueue(task);

export const getSuppliersSession = (): Promise<SharedSession> =>
	suppliersBrowserSession.get();

export const cleanupSuppliersSession = (): Promise<void> =>
	suppliersBrowserSession.cleanup();
