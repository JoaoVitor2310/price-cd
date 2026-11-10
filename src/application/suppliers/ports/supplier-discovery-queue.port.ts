/**
 * Um pedido de Descoberta de Fornecedores. A varredura não tem parâmetro — é
 * sempre a mesma —, então o pedido guarda só quando foi feito: é o que diz, no
 * log e no registro do job, quanto ele esperou na fila.
 */
export type SupplierDiscoveryRequest = {
	/** ISO 8601. */
	requestedAt: string;
};

/**
 * A fila da Descoberta de Fornecedores, com a mesma regra da do Reabastecimento
 * (`ListsRunQueue`): dado em vez de closure, e `enqueue` só resolve com o pedido
 * guardado.
 */
export abstract class SupplierDiscoveryQueue {
	abstract enqueue(request: SupplierDiscoveryRequest): Promise<void>;
}
