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
		try {
			await axios.post(callbackUrl, payload, { timeout });
		} catch (error) {
			// console.log("error");
			console.error("❌ [ERROR] Failed to post callback:", error);
		}
	}
}

export const createAxiosRunListsCallbackPoster = (
	options?: { timeoutMs?: number },
): RunListsCallbackPoster => new AxiosRunListsCallbackPoster(options);
