import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	Post,
	UseFilters,
} from "@nestjs/common";
import { EnqueueRunListsUseCase } from "@/application/lists/use-cases/enqueue-run-lists.use-case.js";
import { ListsLegacyErrorFilter } from "@/nest/lists/lists-legacy-error.filter.js";
import { ZodValidationPipe } from "@/nest/common/zod-validation.pipe.js";
import {
	enqueueRunListSchema,
	type SupplierListRequest,
} from "@/schemas/list.schema.js";

/**
 * O Reabastecimento de Fornecedores.
 *
 * Substitui `routes/list/run-list.route.ts` e `controllers/lists/run-lists.controller.ts`.
 * A rota só enfileira: o trabalho real — raspar as Listas do SteamTrades,
 * precificar e criar a Trade — leva minutos e roda em background.
 */
@Controller("lists")
@UseFilters(ListsLegacyErrorFilter)
export class ListsController {
	constructor(
		private readonly enqueueRunListsUseCase: EnqueueRunListsUseCase,
	) {}

	// 202, não 200: o contrato é "aceitei e enfileirei", não "terminei".
	// Sem isto o `@Post()` responderia 201.
	@Post("run")
	@HttpCode(HttpStatus.ACCEPTED)
	async run(
		@Body(new ZodValidationPipe(enqueueRunListSchema)) body: SupplierListRequest,
	) {
		await this.enqueueRunListsUseCase.execute({ request: body });
		return { success: true, status: "queued" };
	}
}
