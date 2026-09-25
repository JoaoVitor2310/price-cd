import {
	Controller,
	Logger,
	HttpCode,
	HttpStatus,
	Post,
	UseFilters,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/env.schema.js";
import { assertSuppliersEnv } from "@/nest/suppliers/suppliers.module.js";
import { SuppliersLegacyErrorFilter } from "@/nest/suppliers/suppliers-legacy-error.filter.js";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/use-cases/enqueue-find-new-suppliers.use-case.js";

/**
 * A Descoberta de Fornecedores.
 *
 * Substitui `routes/suppliers.route.ts` e
 * `controllers/suppliers/find-new-suppliers.controller.ts`.
 *
 * Não valida corpo nenhum: a rota ignora o que for enviado — a varredura é
 * sempre a mesma. Por isso não há `@Body` nem pipe aqui, e nenhum filter
 * próprio: esta rota não tem 400 no contrato.
 */
@Controller("suppliers")
@UseFilters(SuppliersLegacyErrorFilter)
export class SuppliersController {
	private readonly logger = new Logger(SuppliersController.name);

	constructor(
		private readonly enqueueFindNewSuppliers: EnqueueFindNewSuppliersUseCase,
		private readonly config: ConfigService<Env, true>,
	) {}

	@Post("find-new")
	@HttpCode(HttpStatus.ACCEPTED)
	async findNew() {
		// Falha ainda no ciclo da requisição se faltar configuração — depois de
		// enfileirado não há mais ninguém para receber o erro. O Express faz o
		// mesmo dentro de `createFindNewSuppliersRunner()`.
		assertSuppliersEnv(this.config);

		this.logger.log("Queuing new suppliers search…");
		await this.enqueueFindNewSuppliers.execute();
		return { success: true, status: "queued" };
	}
}
