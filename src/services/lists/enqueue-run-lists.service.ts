import { EnqueueRunListsUseCase } from "@/application/lists/enqueue-run-lists.use-case.js";
import type {
	BackgroundScheduler,
	RunListsRunner,
} from "@/application/lists/ports/list-run.ports.js";
import { createLimitedConcurrencySchedulerFromEnv } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { AxiosRunListsCallbackPoster } from "@/infrastructure/http/axios-run-lists-callback-poster.js";
import type { VipListRequest } from "@/schemas/list.schema.js";
import {
	runListsService,
	type RunListsServiceResult,
} from "@/services/lists/run-lists.service.js";

class RunListsServiceRunner implements RunListsRunner {
	async run(vipListRequest: VipListRequest): Promise<RunListsServiceResult> {
		return runListsService(vipListRequest);
	}
}

const enqueueRunListsUseCase = new EnqueueRunListsUseCase();

/** Um scheduler por processo; antes cada POST criava um scheduler novo e todos os jobs disparavam em paralelo. */
let sharedRunListsScheduler: BackgroundScheduler | undefined;

function getSharedRunListsScheduler(): BackgroundScheduler {
	if (!sharedRunListsScheduler) {
		sharedRunListsScheduler = createLimitedConcurrencySchedulerFromEnv();
	}
	return sharedRunListsScheduler;
}

/**
 * Service to enqueue the run lists use case.
 * @param request - The request object containing the list array and callback URL.
 */
export const enqueueRunListsService = async (vipListRequest: VipListRequest) => {
	await enqueueRunListsUseCase.execute({
		request: vipListRequest,
		scheduler: getSharedRunListsScheduler(),
		runner: new RunListsServiceRunner(),
		callbackPoster: new AxiosRunListsCallbackPoster(),
	});
};
