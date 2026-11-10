import type { SupplierDiscoveryQueue } from "@/application/suppliers/ports/supplier-discovery-queue.port.js";

/**
 * Guarda o pedido de Descoberta de Fornecedores na fila. O cliente HTTP recebe a
 * confirmação assim que o pedido está guardado; a varredura pode levar minutos
 * (até 100 páginas do SteamTrades, uma pesquisa de preços por tópico elegível) e
 * é o `FindNewSuppliersUseCase`, chamado pela fila, que a executa.
 *
 * Sem try/catch: não conseguir guardar chega a quem está na requisição. Um pedido
 * feito com outra varredura esperando ou rodando é absorvido por ela (a fila
 * deduplica), e quem pediu recebe o mesmo `202`.
 */
export class EnqueueFindNewSuppliersUseCase {
	constructor(
		private readonly queue: SupplierDiscoveryQueue,
		private readonly now: () => Date = () => new Date(),
	) {}

	async execute(): Promise<void> {
		await this.queue.enqueue({ requestedAt: this.now().toISOString() });
	}
}
