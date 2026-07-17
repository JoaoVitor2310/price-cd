import { delay } from "@/helpers/utils.js";
import { TimeoutError } from "puppeteer";
import { PageWithCursor } from "puppeteer-real-browser";

export async function gotoWithRetry(page: PageWithCursor, url: string, maxRetries = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
            });

            const status = response?.status();

            if (status === 429) {
                const retryAfterHeader = response?.headers()['retry-after'];
                const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;

                console.warn(`⚠️ [INFO] Too many requests(puppeteer). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`);

                await delay(retryAfterSeconds * 1000);
                continue;
            }

            return true;
        } catch (error) {
            if (error instanceof TimeoutError) {
                console.warn(
                    `⚠️ [INFO] Timeout trying to navigate to ${url}. Attempt ${attempt}/${maxRetries}`
                );
                if (attempt < maxRetries) {
                    await delay(3000);
                    continue;
                }
            }

            console.error(`❌ [ERROR] Failed to navigate to ${url}, error:`, error);
            return false;
        }
    }

    return false;
}
