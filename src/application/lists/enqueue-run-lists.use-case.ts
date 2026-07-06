import type { SupplierListRequest } from "@/schemas/list.schema.js";
import type {
	BackgroundScheduler,
	RunListsRunner,
} from "@/application/lists/ports/list-run.ports.js";

export type EnqueueRunListsInput = {
	request: SupplierListRequest;
	scheduler: BackgroundScheduler;
	runner: RunListsRunner;
};

export class EnqueueRunListsUseCase {
	async execute(input: EnqueueRunListsInput): Promise<void> {
		const { request, scheduler, runner } = input;

		scheduler.schedule(async () => {
			try {
				await runner.run(request);
			} catch (error) {
				console.error("❌ [ERROR] List run failed:", error);
			}
		});
	}
}
