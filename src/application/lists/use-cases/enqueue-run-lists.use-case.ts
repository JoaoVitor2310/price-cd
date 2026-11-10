import type { ListsRunQueue } from "@/application/lists/ports/lists-run-queue.port.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

/** Só dado: as dependências estão no construtor. */
export type EnqueueRunListsInput = {
	request: SupplierListRequest;
};

/**
 * Guarda o pedido de Reabastecimento na fila; quem o executa é o
 * `RunListsUseCase`, chamado pela fila. Sem try/catch: não conseguir guardar
 * chega a quem está na requisição.
 */
export class EnqueueRunListsUseCase {
	constructor(private readonly queue: ListsRunQueue) {}

	async execute(input: EnqueueRunListsInput): Promise<void> {
		await this.queue.enqueue(input.request);
	}
}
