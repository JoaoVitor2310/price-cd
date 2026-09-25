/**
 * A MESMA bateria de contrato do Express, agora contra o app Nest.
 *
 * `only` lista as rotas cujo módulo já foi migrado — hoje as duas de busca
 * (PR 3). Ela cresce a cada PR de módulo, e quando puder ser apagada a paridade
 * está provada (`docs/NEST.md` §4).
 *
 * Note que aqui não há `vi.mock`: o container faz o trabalho. `overrideProvider`
 * troca a implementação registrada pelo token da porta — é substituição de
 * dependência de verdade, não interceptação de módulo. Os dublês são os mesmos
 * do Express, de propósito: mesmo fake, mesma entrada, a resposta HTTP tem que
 * ser idêntica.
 *
 * **Todo efeito externo precisa de dublê aqui, igual ao lado Express.** A
 * primeira versão deste arquivo só substituía os fetchers de preço: o
 * `LISTS_SCHEDULER` era a fila real e a `ListTopicFetcherFactory` era a de
 * produção, então o caso de 202 de `/api/lists/run` disparava Puppeteer de
 * verdade durante a suíte. Passava — e deixava um Chromium subindo.
 */

import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll } from "vitest";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import { LISTS_SCHEDULER } from "@/nest/lists/lists.tokens.js";
import { SUPPLIERS_SCHEDULER } from "@/nest/suppliers/suppliers.tokens.js";
import { RESEARCH_SCHEDULER } from "@/nest/games/games.tokens.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";
import { runApiContract } from "./api-contract.suite.js";
import {
	listTopicFetcherDouble,
	popularityFetcherDouble,
	priceFetcherDouble,
	schedulerDouble,
} from "./doubles.js";

let app: NestExpressApplication;

async function createApp(): Promise<NestExpressApplication> {
	const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(PopularityFetcher)
		.useValue(popularityFetcherDouble())
		.overrideProvider(PriceFetcher)
		.useValue(priceFetcherDouble())
		// As filas são inertes e o fetcher é dublê pelos MESMOS motivos do lado
		// Express (`express.contract.test.ts`): o contrato de um 202 é "aceitei e
		// enfileirei", e executar a tarefa de verdade abriria um Chromium no meio
		// da suíte — num projeto que já caiu por browser órfão.
		.overrideProvider(LISTS_SCHEDULER)
		.useValue(schedulerDouble())
		.overrideProvider(RESEARCH_SCHEDULER)
		.useValue(schedulerDouble())
		.overrideProvider(SUPPLIERS_SCHEDULER)
		.useValue(schedulerDouble())
		.overrideProvider(ListTopicFetcherFactory)
		.useValue({ create: listTopicFetcherDouble })
		.compile();

	const created = moduleRef.createNestApplication<NestExpressApplication>();
	// A MESMA configuração do `src/main.ts`, não uma cópia: é o que faz este
	// teste cobrar o bootstrap real de produção.
	configureNestApp(created);
	await created.init();
	return created;
}

beforeAll(async () => {
	// Atribuição FORÇADA, igual ao `express.contract.test.ts`: a bateria não pode
	// ter ambiente como entrada escondida. Sem isto ela passava na máquina de
	// quem tem `.env` e quebrava no CI — foi exatamente o que aconteceu.
		// O agendador de bump abre um Chromium e fala com o SteamTrades no
		// primeiro tick. Nenhum teste quer isso acontecendo por baixo.
		process.env.BUMP_SCHEDULER_ENABLED = "false";
	process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
	process.env.EXTERNAL_SECRET = "contract-external-secret";
	process.env.STEAMTRADES_SESSION = "contract-session-cookie";

	app = await createApp();
});

afterAll(async () => {
	await app?.close();
});

runApiContract({
	getServer: () => app.getHttpServer(),
	only: [
		"/api/games/search",
		"/api/games/search-id-steam",
		"/api/games/research",
		"/api/lists/run",
		"/api/suppliers/find-new",
	],

	/**
	 * O Nest valida e congela o ambiente no boot (`ConfigModule`, `cache: true`),
	 * então mutar `process.env` no meio do teste não teria efeito nenhum — o app
	 * já leu tudo. A única forma honesta de um caso mudar o ambiente é
	 * **reconstruir o app**. Caro, por isso só acontece quando o caso pede.
	 */
	withEnv: async (env, run) => {
		if (Object.keys(env).length === 0) return run();

		const previous = new Map(
			Object.keys(env).map((key) => [key, process.env[key]] as const),
		);
		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}

		const previousApp = app;
		app = await createApp();

		try {
			return await run();
		} finally {
			await app.close();
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
			app = previousApp;
		}
	},
});
