import { delay } from "@/helpers/utils.js";
import { TimeoutError } from "puppeteer";
import { PageWithCursor } from "puppeteer-real-browser";
import { describeDiagnosis, diagnoseFailedNavigation } from "@/lib/navigation-diagnostics.js";

/**
 * Chamada só quando a navegação desistiu de vez. O `TimeoutError` sozinho não diz se o
 * Chromium travou, morreu ou se a Cloudflare segurou a página — o diagnóstico diz.
 */
async function logFailureDiagnosis(page: PageWithCursor, url: string): Promise<void> {
    const diagnosis = await diagnoseFailedNavigation(page);
    console.error(`🩺 [DIAGNOSIS] Navigation to ${url} gave up: ${describeDiagnosis(diagnosis)}`);
}

/** A resposta da `page` do `puppeteer-real-browser`, que não é a do `puppeteer`. */
type NavigationResponse = Awaited<ReturnType<PageWithCursor["goto"]>>;

/**
 * Navega repetindo em `TimeoutError` e HTTP 429, e devolve a última resposta: para
 * quem precisa do status. Esgotadas as tentativas, o 429 volta como resposta e o
 * timeout é lançado. Qualquer outro erro é lançado na hora.
 */
export async function gotoResponseWithRetry(
    page: PageWithCursor,
    url: string,
    { timeout = 20000, maxRetries = 3 }: { timeout?: number; maxRetries?: number } = {},
): Promise<NavigationResponse> {
    for (let attempt = 1; ; attempt++) {
        try {
            const response = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout,
            });

            if (response?.status() !== 429 || attempt >= maxRetries) return response;

            const retryAfterHeader = response.headers()['retry-after'];
            const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;

            console.warn(`⚠️ [INFO] Too many requests(puppeteer). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`);

            await delay(retryAfterSeconds * 1000);
        } catch (error) {
            if (!(error instanceof TimeoutError)) throw error;

            console.warn(
                `⚠️ [INFO] Timeout trying to navigate to ${url}. Attempt ${attempt}/${maxRetries}`
            );
            if (attempt >= maxRetries) throw error;

            await delay(3000);
        }
    }
}

export async function gotoWithRetry(page: PageWithCursor, url: string, maxRetries = 3): Promise<boolean> {
    try {
        const response = await gotoResponseWithRetry(page, url, { maxRetries });
        if (response?.status() !== 429) return true;
    } catch (error) {
        console.error(`❌ [ERROR] Failed to navigate to ${url}, error:`, error);
    }

    await logFailureDiagnosis(page, url);
    return false;
}
