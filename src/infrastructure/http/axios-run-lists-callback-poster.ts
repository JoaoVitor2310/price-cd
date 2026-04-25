import axios from "axios";
import type {
	RunListsCallbackPayload,
	RunListsCallbackPoster,
} from "@/application/lists/ports/list-run.ports.js";

export class AxiosRunListsCallbackPoster implements RunListsCallbackPoster {
	constructor(private readonly options?: { timeoutMs?: number }) {}

	async postCallback(
		callbackUrl: string,
		payload: RunListsCallbackPayload,
	): Promise<void> {
		const timeout = this.options?.timeoutMs ?? 30_000;
		const secret = process.env.EXTERNAL_SECRET;

		const headers: Record<string, string> = {};
		if (secret) {
			headers.Authorization = `Bearer ${secret}`;
		} else {
			console.warn("⚠️ [WARN] EXTERNAL_SECRET não definido — callback enviado sem autenticação.");
		}

		try {
			await axios.post(callbackUrl, payload, { timeout, headers });
		} catch (error) {
			console.error("❌ [ERROR] Failed to post callback:", error);
		}
	}
}

export const createAxiosRunListsCallbackPoster = (
	options?: { timeoutMs?: number },
): RunListsCallbackPoster => new AxiosRunListsCallbackPoster(options);
