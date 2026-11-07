import * as z from "zod";
import type {
	ResearchFailureTarget,
	ResearchJobRequest,
} from "@/application/games/ports/research-games-runner.port.js";
import { OFFER_CURRENCIES } from "@/domain/suppliers/offer.js";

/**
 * O formato persistido de um job da fila da pesquisa: o `ResearchJobRequest`
 * como ele volta do Redis. Ver `docs/adr/0009-fila-duravel-da-pesquisa.md`.
 *
 * Vive em `infrastructure/`, e não em `src/schemas/`: aquela pasta é o contrato
 * HTTP que o `nest/` valida na entrada; isto é o formato de **armazenamento**
 * do adapter, lido pelo worker. A Application só conhece o tipo.
 *
 * O que está no Redis pode ter sido gravado por outra versão do código (o job
 * sobrevive ao deploy, é o objetivo). Payload que não casa falha o job com uma
 * mensagem legível em vez de chegar torto ao use case.
 *
 * `looseObject` em todos os níveis, de propósito: o schema confere o que o use
 * case precisa, mas **não apaga** o resto. Com `z.object`, um campo novo do
 * pedido que alguém esquecesse de declarar aqui
 * sumiria em silêncio entre o `enqueue` e o worker. O teste de ida e volta em
 * `research-job-payload.test.ts` trava isso.
 */
const commonJobFields = {
	criteria: z.looseObject({
		popularity: z.looseObject({
			upToThreshold: z.number(),
			aboveThreshold: z.number(),
			priceThresholdEuro: z.number(),
		}),
		lookupPopularity: z.boolean(),
		minPrice: z.number(),
		checkGamivoOffer: z.boolean(),
	}),
	supplierSteamId: z.string().optional(),
	listCode: z.string().optional(),
	title: z.string().optional(),
	currency: z.enum(OFFER_CURRENCIES).optional(),
	requestUuid: z.string().min(1).optional(),
	webhookUrl: z.string().min(1).optional(),
};

const researchJobPayloadSchema = z.union([
	z.looseObject({ gameNames: z.array(z.string()).min(1), ...commonJobFields }),
	z.looseObject({ topicUrl: z.string().min(1), ...commonJobFields }),
]);

export const parseResearchJobPayload = (data: unknown): ResearchJobRequest => {
	const parsed = researchJobPayloadSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(`Invalid research job payload: ${parsed.error.message}`);
	}
	return parsed.data;
};

/**
 * A quem avisar uma falha, lido sem exigir o resto do pedido: um payload que o
 * `parseResearchJobPayload` recusa ainda pode dizer para onde vai o aviso, e sem
 * isso quem recebeu `202` ficaria sem resposta.
 *
 * Campo a campo, com os mesmos validadores do pedido: um `requestUuid` ilegível
 * não pode custar o `webhookUrl`. Faltando ele, vale o id do job — o `enqueue`
 * usa o `requestUuid` como `jobId`, e só há webhook com `requestUuid`.
 */
export const readResearchFailureTarget = (
	data: unknown,
	jobId?: string,
): ResearchFailureTarget => {
	const record =
		typeof data === "object" && data !== null
			? (data as Record<string, unknown>)
			: {};
	const webhookUrl = readField(commonJobFields.webhookUrl, record.webhookUrl);
	if (webhookUrl === undefined) return {};
	const requestUuid =
		readField(commonJobFields.requestUuid, record.requestUuid) ?? jobId;
	return { webhookUrl, requestUuid };
};

const readField = <T>(schema: z.ZodType<T>, value: unknown): T | undefined => {
	const parsed = schema.safeParse(value);
	return parsed.success ? parsed.data : undefined;
};
