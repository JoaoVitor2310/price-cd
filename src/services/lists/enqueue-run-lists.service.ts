import { EnqueueRunListsUseCase } from "@/application/lists/enqueue-run-lists.use-case.js";
import type { RunListsRunner } from "@/application/lists/ports/list-run.ports.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import { createLimitedConcurrencySchedulerFromEnv } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";
import { runListsService } from "@/services/lists/run-lists.service.js";

class RunListsServiceRunner implements RunListsRunner {
	async run(supplierListRequest: SupplierListRequest): Promise<void> {
		return runListsService(supplierListRequest);
	}
}

const enqueueRunListsUseCase = new EnqueueRunListsUseCase();

let sharedRunListsScheduler: BackgroundScheduler | undefined;

function getSharedRunListsScheduler(): BackgroundScheduler {
	if (!sharedRunListsScheduler) {
		sharedRunListsScheduler = createLimitedConcurrencySchedulerFromEnv();
	}
	return sharedRunListsScheduler;
}

export const enqueueRunListsService = async (supplierListRequest: SupplierListRequest) => {
	await enqueueRunListsUseCase.execute({
		request: supplierListRequest,
		scheduler: getSharedRunListsScheduler(),
		runner: new RunListsServiceRunner(),
	});
};
