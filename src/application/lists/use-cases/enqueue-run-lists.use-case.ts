import type { SupplierListRequest } from "@/schemas/list.schema.js";
import type { RunListsRunner } from "@/application/lists/ports/list-run.ports.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";

/** Só dado: as dependências estão no construtor. */
export type EnqueueRunListsInput = {
	request: SupplierListRequest;
};

export class EnqueueRunListsUseCase {
	constructor(
		private readonly scheduler: BackgroundScheduler,
		private readonly runner: RunListsRunner,
	) {}

	async execute(input: EnqueueRunListsInput): Promise<void> {
		const { request } = input;
		const { scheduler, runner } = this;

		scheduler.schedule(async () => {
			try {
				await runner.run(request);
			} catch (error) {
				console.error("❌ [ERROR] List run failed:", error);
			}
		});
	}
}
