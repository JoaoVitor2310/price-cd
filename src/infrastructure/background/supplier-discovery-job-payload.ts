import * as z from "zod";
import type { SupplierDiscoveryRequest } from "@/application/suppliers/ports/supplier-discovery-queue.port.js";

/**
 * O formato persistido de um job da fila da Descoberta de Fornecedores. Mesmas
 * regras do `research-job-payload.ts`.
 */
const supplierDiscoveryJobPayloadSchema = z.looseObject({
	requestedAt: z.string().min(1),
});

export const parseSupplierDiscoveryJobPayload = (
	data: unknown,
): SupplierDiscoveryRequest => {
	const parsed = supplierDiscoveryJobPayloadSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(`Invalid suppliers job payload: ${parsed.error.message}`);
	}
	return parsed.data;
};
