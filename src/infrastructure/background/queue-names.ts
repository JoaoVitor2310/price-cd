/**
 * Os nomes das filas BullMQ do price-cd, todas no banco 1 do Redis (ADR 0009).
 * Num lugar só porque o painel das filas (ADR 0011) lista todas: uma fila nova
 * que não entrasse aqui ficaria invisível nele.
 */
export const RESEARCH_QUEUE_NAME = "research";
export const WEBHOOK_QUEUE_NAME = "webhooks";
export const LISTS_QUEUE_NAME = "lists";
export const SUPPLIERS_QUEUE_NAME = "suppliers";

export const QUEUE_NAMES = [
	RESEARCH_QUEUE_NAME,
	WEBHOOK_QUEUE_NAME,
	LISTS_QUEUE_NAME,
	SUPPLIERS_QUEUE_NAME,
] as const;
