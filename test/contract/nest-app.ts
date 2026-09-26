import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";
import { RESEARCH_SCHEDULER } from "@/nest/games/games.tokens.js";
import { LISTS_SCHEDULER } from "@/nest/lists/lists.tokens.js";
import { SUPPLIERS_SCHEDULER } from "@/nest/suppliers/suppliers.tokens.js";
import {
	listTopicFetcherDouble,
	popularityFetcherDouble,
	priceFetcherDouble,
	schedulerDouble,
} from "./doubles.js";

/**
 * Sobe o app Nest com **todo** efeito externo substituído por dublê.
 *
 * Existe num arquivo só de propósito. Esta lista estava duplicada em dois
 * arquivos de teste, já com ordem divergente — e o risco não é estético:
 * esquecer um dublê num dos dois faz aquele arquivo **abrir um Chromium de
 * verdade**. Já aconteceu (PR 7), e encheu a máquina de janelas do Chrome.
 *
 * A trava do `initializeBrowser()` transformaria isso numa falha legível em vez
 * de janelas, mas um teste que falha por esquecimento continua sendo um teste
 * quebrado. Um lugar só resolve os dois.
 */
/**
 * Fixa o ambiente da bateria. Chame **uma vez**, no `beforeAll`.
 *
 * Atribuição forçada porque a suíte não pode ter o ambiente da máquina como
 * entrada escondida: sem isto ela passava para quem tem `.env` e quebrava no
 * CI — foi exatamente o que aconteceu no PR 1.
 *
 * Separado de `createContractNestApp` de propósito: alguns casos de contrato
 * apagam uma variável e reconstroem o app para provar o comportamento sem ela.
 * Se a construção refizesse este setup, ela desfaria o que o caso acabou de
 * preparar.
 */
export function setContractEnv(): void {
	process.env.BUMP_SCHEDULER_ENABLED = "false";
	process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
	process.env.EXTERNAL_SECRET = "contract-external-secret";
	process.env.STEAMTRADES_SESSION = "contract-session-cookie";
}

export async function createContractNestApp(): Promise<NestExpressApplication> {
	const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(PopularityFetcher)
		.useValue(popularityFetcherDouble())
		.overrideProvider(PriceFetcher)
		.useValue(priceFetcherDouble())
		.overrideProvider(ListTopicFetcherFactory)
		.useValue({ create: listTopicFetcherDouble })
		// As filas são inertes: o contrato de um 202 é "aceitei e enfileirei",
		// e executar a tarefa arrastaria scraping real para dentro do teste.
		.overrideProvider(LISTS_SCHEDULER)
		.useValue(schedulerDouble())
		.overrideProvider(RESEARCH_SCHEDULER)
		.useValue(schedulerDouble())
		.overrideProvider(SUPPLIERS_SCHEDULER)
		.useValue(schedulerDouble())
		.compile();

	const app = moduleRef.createNestApplication<NestExpressApplication>();
	// A MESMA configuração do `src/main.ts`, não uma cópia.
	configureNestApp(app);
	await app.init();
	return app;
}
