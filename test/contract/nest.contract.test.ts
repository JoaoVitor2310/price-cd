/**
 * A MESMA bateria de contrato do Express, agora contra o app Nest.
 *
 * **Sem `only`: a paridade está provada.** Durante os PRs 3 a 7 esta bateria
 * rodava com uma lista de rotas — o app Nest só era cobrado pelo que já tinha
 * sido migrado. No PR 8 a lista foi removida: as cinco rotas, o `GET /` e o 404
 * respondem igual nos dois apps.
 *
 * Reintroduzir `only` aqui é dar um passo atrás na migração, e deve ser
 * justificado no PR que o fizer.
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
import { afterAll, beforeAll } from "vitest";
import { runApiContract } from "./api-contract.suite.js";
import { createContractNestApp, setContractEnv } from "./nest-app.js";

let app: NestExpressApplication;

beforeAll(async () => {
	setContractEnv();
	app = await createContractNestApp();
});

afterAll(async () => {
	await app?.close();
});

runApiContract({
	getServer: () => app.getHttpServer(),

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
		app = await createContractNestApp();

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
