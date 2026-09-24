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
 */

import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll } from "vitest";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";
import { runApiContract } from "./api-contract.suite.js";
import { popularityFetcherDouble, priceFetcherDouble } from "./doubles.js";

let app: NestExpressApplication;

async function createApp(): Promise<NestExpressApplication> {
	const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
		.overrideProvider(PopularityFetcher)
		.useValue(popularityFetcherDouble())
		.overrideProvider(PriceFetcher)
		.useValue(priceFetcherDouble())
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
