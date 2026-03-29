import type { VipListRequest } from "@/schemas/list.schema.js";
import type {
	BackgroundScheduler,
	RunListsCallbackPoster,
	RunListsRunner,
} from "@/application/lists/ports/list-run.ports.js";

export type EnqueueRunListsInput = {
	request: VipListRequest;
	scheduler: BackgroundScheduler;
	runner: RunListsRunner;
	callbackPoster: RunListsCallbackPoster;
};

/**
 * Use case: dispara execução em background e notifica via callback.
 */
export class EnqueueRunListsUseCase {
	async execute(input: EnqueueRunListsInput): Promise<void> {
		const { request, scheduler, runner, callbackPoster } = input;

		scheduler.schedule(async () => {
			const callbackUrl = request.callback_url;

			try {
				const result = await runner.run(request);
				await callbackPoster.postCallback(callbackUrl, {
					status: "completed",
					result: result.result,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : "Unknown error";
				try {
					await callbackPoster.postCallback(callbackUrl, {
						status: "failed",
						result: message,
					});
				} catch (callbackError) {
					// Sem persistência/fila, só logamos falha de callback.
					console.error("❌ [ERROR] Callback POST failed:", callbackError);
				}
			}
		});
	}
}
