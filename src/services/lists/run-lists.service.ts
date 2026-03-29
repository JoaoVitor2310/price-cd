import type { VipListRequest } from "@/schemas/list.schema.js";
import { RunListsUseCase } from "@/application/lists/run-lists.use-case.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { formatList } from "@/infrastructure/lists/format-list-result.js";

export type RunListsServiceResult = {
	status: "completed" | "failed";
	result: string;
};

const runListsUseCase = new RunListsUseCase();

/**
 * Camada de “aplicação” exposta ao Express: compõe portas
 * e delega ao caso de uso.
 */
export const runListsService = async (
	vipListRequest: VipListRequest,
	options?: { checkGamivoOffer?: boolean },
): Promise<RunListsServiceResult> => {
	const listResult = await runListsUseCase.execute({
		vipListRequest,
		fetcher: fetchListTopic(),
		checkGamivoOffer: options?.checkGamivoOffer ?? true,
		formatter: formatList(),
	});

	return {
		status: listResult.status,
		result: listResult.result,
	};
};
