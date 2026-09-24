/**
 * A bateria de contrato rodando contra o app Express — o app em produção.
 *
 * Enquanto a migração para Nest acontece (`docs/NEST.md`), este arquivo é a
 * prova de que o Express continua respondendo igual: os PRs de módulo alteram
 * assinatura de use case compartilhado, e é aqui que uma quebra aparece.
 *
 * `nest.contract.test.ts` nasce no PR 3 e consome a MESMA suíte, com opt-in por
 * rota. Um caso escrito aqui cobra os dois apps automaticamente.
 */

import { beforeAll, vi } from "vitest";
import {
	popularityFetcherDouble,
	priceFetcherDouble,
	schedulerDouble,
	tradeImporterDouble,
} from "./doubles.js";
import { runApiContract } from "./api-contract.suite.js";

vi.mock("@/infrastructure/games/steam-charts-popularity-fetcher.js", () => ({
	SteamChartsPopularityFetcher: vi.fn(popularityFetcherDouble),
}));

vi.mock("@/infrastructure/games/allkeyshop-price-fetcher.js", () => ({
	AllKeyShopPriceFetcher: vi.fn(priceFetcherDouble),
}));

vi.mock("@/infrastructure/games/http-game-trade-importer.js", () => ({
	HttpGameTradeImporter: vi.fn(tradeImporterDouble),
}));

vi.mock("@/infrastructure/background/limited-concurrency.scheduler.js", () => ({
	LimitedConcurrencyScheduler: vi.fn(schedulerDouble),
	createLimitedConcurrencySchedulerFromEnv: vi.fn(schedulerDouble),
}));

// O fluxo `lists` e a Descoberta raspam o SteamTrades dentro da tarefa
// enfileirada. Com o agendador inerte a tarefa nunca roda, mas os módulos ainda
// são importados na montagem — então precisam existir sem abrir browser.
vi.mock("@/infrastructure/lists/fetch-list-topic.js", () => ({
	FetchListTopic: vi.fn(() => ({
		fetchList: async () => ({ topicRef: "", status: "inactive", gameNames: [] }),
		dispose: async () => {},
	})),
}));

let app: Awaited<typeof import("@/app.js")>["default"];

beforeAll(async () => {
	// Atribuição FORÇADA, não `??=`: `src/app.ts` chama `dotenv.config()`, então
	// o `.env` da máquina vaza para dentro do teste. Com `??=` a bateria passava
	// localmente (onde o `.env` existe) e quebrava em CI — e, pior, o resultado
	// dependia do que cada dev tem configurado. Um teste de contrato não pode ter
	// ambiente como entrada escondida.
	process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
	process.env.EXTERNAL_SECRET = "contract-external-secret";
	process.env.STEAMTRADES_SESSION = "contract-session-cookie";

	app = (await import("@/app.js")).default;
});

runApiContract({
	getServer: () => app,
	// O Express lê `process.env` a cada request, então mutar e restaurar basta.
	// O app Nest precisará de outra estratégia — ver `ContractApp.withEnv`.
	withEnv: async (env, run) => {
		const previous = new Map(
			Object.keys(env).map((key) => [key, process.env[key]]),
		);

		for (const [key, value] of Object.entries(env)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}

		try {
			return await run();
		} finally {
			for (const [key, value] of previous) {
				if (value === undefined) delete process.env[key];
				else process.env[key] = value;
			}
		}
	},
});
