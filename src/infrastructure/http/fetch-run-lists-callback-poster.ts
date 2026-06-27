import type {
	RunListsCallbackPayload,
	RunListsCallbackPoster,
} from "@/application/lists/ports/list-run.ports.js";

export class FetchRunListsCallbackPoster implements RunListsCallbackPoster {
	constructor(private readonly options?: { timeoutMs?: number }) {}

	async postCallback(
		callbackUrl: string,
		payload: RunListsCallbackPayload,
	): Promise<void> {
		const timeoutMs = this.options?.timeoutMs ?? 30_000;
		const secret = process.env.EXTERNAL_SECRET;

		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (secret) {
			headers.Authorization = `Bearer ${secret}`;
		} else {
			console.warn("⚠️ [WARN] EXTERNAL_SECRET não definido — callback enviado sem autenticação.");
		}

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		try {
			await fetch(callbackUrl, {
				method: "POST",
				signal: controller.signal,
				headers,
				body: JSON.stringify(payload),
			});
		} catch (error) {
			console.error("❌ [ERROR] Failed to post callback:", error);
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

export const createFetchRunListsCallbackPoster = (
	options?: { timeoutMs?: number },
): RunListsCallbackPoster => new FetchRunListsCallbackPoster(options);
