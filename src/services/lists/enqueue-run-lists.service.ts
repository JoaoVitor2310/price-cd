import { EnqueueRunListsUseCase } from "@/application/lists/enqueue-run-lists.use-case.js";
import type { VipListRequest } from "@/schemas/list.schema.js";
import { SetImmediateScheduler } from "@/infrastructure/background/set-immediate.scheduler.js";
import { AxiosRunListsCallbackPoster } from "@/infrastructure/http/axios-run-lists-callback-poster.js";
import {
	runListsService,
	type RunListsServiceResult,
} from "@/services/lists/run-lists.service.js";
import type { RunListsRunner } from "@/application/lists/ports/list-run.ports.js";

class RunListsServiceRunner implements RunListsRunner {
	async run(vipListRequest: VipListRequest): Promise<RunListsServiceResult> {
		return runListsService(vipListRequest);
	}
}

const enqueueRunListsUseCase = new EnqueueRunListsUseCase();

/**
 * Service to enqueue the run lists use case.
 * @param request - The request object containing the list array and callback URL.
 */
export const enqueueRunListsService = async (vipListRequest: VipListRequest) => {
	await enqueueRunListsUseCase.execute({
		request: vipListRequest,
		scheduler: new SetImmediateScheduler(),
		runner: new RunListsServiceRunner(),
		callbackPoster: new AxiosRunListsCallbackPoster(),
	});
};
