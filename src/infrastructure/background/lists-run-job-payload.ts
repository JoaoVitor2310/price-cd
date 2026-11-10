import * as z from "zod";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

/**
 * O formato persistido de um job da fila do Reabastecimento: o pedido como ele
 * volta do Redis. Mesmas regras do `research-job-payload.ts` — formato de
 * armazenamento, não contrato HTTP, e `looseObject` para um campo novo do pedido
 * não sumir entre o `enqueue` e o worker.
 */
const listsRunJobPayloadSchema = z.looseObject({
	steam_id: z.string().min(1),
	checkGamivoOffer: z.boolean(),
});

export const parseListsRunJobPayload = (data: unknown): SupplierListRequest => {
	const parsed = listsRunJobPayloadSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(`Invalid lists job payload: ${parsed.error.message}`);
	}
	return parsed.data;
};
