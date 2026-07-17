import { delay } from "@/helpers/utils.js";

export async function fetchWithRetry(
    url: string,
    maxRetries: number = 3,
    baseDelay: number = 5000
): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let response: Response;
        try {
            response = await fetch(url);
        } catch (error) {
            console.error(`❌ [ERROR] Unknown error while fetching page:`, error);
            throw error;
        }

        if (response.ok) {
            return response.text();
        }

        if (response.status === 429) {
            const retryAfterHeader = response.headers.get("retry-after");
            const retryAfterSeconds = retryAfterHeader
                ? parseInt(retryAfterHeader, 10)
                : Math.pow(2, attempt - 1) * (baseDelay / 1000);

            console.log(
                `⚠️ [INFO] Too many requests(fetch). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`
            );
            await delay(retryAfterSeconds * 1000);
        } else {
            console.error(
                `⚠️ [INFO] Service Unavailable. Attempt ${attempt}/${maxRetries}. Retrying in 1.5s...`
            );
            await delay(1500);
        }
    }

    throw new Error(`❌ [ERROR] Failed after ${maxRetries} attempts: ${url}`);
}
