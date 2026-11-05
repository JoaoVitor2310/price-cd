import * as z from "zod";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";

/**
 * O formato persistido de um job da fila da pesquisa: o `ResearchGamesRequest`
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
 * pedido (o `webhook_url` do PR 2) que alguém esquecesse de declarar aqui
 * sumiria em silêncio entre o `enqueue` e o worker. O teste de ida e volta em
 * `research-job-payload.test.ts` trava isso.
 */
const researchJobPayloadSchema = z.looseObject({
	gameNames: z.array(z.string()).min(1),
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
});

export const parseResearchJobPayload = (
	data: unknown,
): ResearchGamesRequest => {
	const parsed = researchJobPayloadSchema.safeParse(data);
	if (!parsed.success) {
		throw new Error(`Invalid research job payload: ${parsed.error.message}`);
	}
	return parsed.data;
};
