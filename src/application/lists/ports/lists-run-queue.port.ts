import type { SupplierListRequest } from "@/schemas/list.schema.js";

/**
 * A fila do Reabastecimento de Fornecedores. Ver
 * `docs/adr/0009-fila-duravel-da-pesquisa.md`, que vale para as três filas.
 *
 * Recebe **dado**, não uma função: o pedido precisa sobreviver a um reinício, e
 * uma closure não sai do processo. `enqueue` só resolve depois de o pedido estar
 * guardado; se não der, lança, e quem chamou recebe o erro em vez de um `202`
 * que promete um Reabastecimento que nunca vai rodar.
 */
export abstract class ListsRunQueue {
	abstract enqueue(request: SupplierListRequest): Promise<void>;
}
