import "reflect-metadata";
import { vi } from "vitest";
import {
	listTopicFetcherDouble,
	popularityFetcherDouble,
	priceFetcherDouble,
	schedulerDouble,
	tradeImporterDouble,
} from "./doubles.js";

/**
 * Os mesmos dublês do `express.contract.test.ts`.
 *
 * Este arquivo faz POST em **todas** as rotas para provar que o Express as
 * atende. Sem estes mocks, esses POSTs enfileiram os jobs de verdade: medido,
 * eram 4 tentativas de abrir Chromium por rodada — barradas só pela trava do
 * `initializeBrowser()`. Um teste que depende da trava para não subir browser
 * está errado, mesmo passando.
 *
 * `vi.mock` é hoisted por arquivo, então não dá para compartilhar estas linhas
 * com os irmãos; só os corpos vêm de `doubles.ts`.
 */
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
vi.mock("@/infrastructure/lists/fetch-list-topic.js", () => ({
	fetchListTopic: vi.fn(listTopicFetcherDouble),
	FetchListTopic: vi.fn(listTopicFetcherDouble),
}));

import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTRACT_ROUTES } from "./contract-cases.js";
import { createContractNestApp, setContractEnv } from "./nest-app.js";

/** Liveness probe: existe para o Docker, não para clientes da API. */
const HEALTH_ROUTE = "/api/health";

/** O prefixo global aplicado por `configureNestApp`. */
const GLOBAL_PREFIX = "/api";

/**
 * Lê as rotas declaradas pelos controllers, direto da metadata dos decorators.
 *
 * Usa `DiscoveryService` + `MetadataScanner`, e **não** o `router.stack` do
 * Express por baixo. A diferença importa: o router é estrutura interna, mudou de
 * nome entre Express 4 e 5 (`_router` → `router`) e não expõe o caminho de
 * montagem. A metadata do decorator é o que o Nest publica.
 */
function declaredRoutes(app: NestExpressApplication): string[] {
	const discovery = app.get(DiscoveryService);
	const scanner = app.get(MetadataScanner);
	const found: string[] = [];

	for (const wrapper of discovery.getControllers()) {
		const { instance, metatype } = wrapper;
		if (!instance || !metatype) continue;

		const controllerPath = Reflect.getMetadata(PATH_METADATA, metatype) ?? "";

		for (const name of scanner.getAllMethodNames(
			Object.getPrototypeOf(instance),
		)) {
			const handler = (instance as Record<string, unknown>)[name];
			const methodPath = Reflect.getMetadata(PATH_METADATA, handler as object);
			if (methodPath === undefined) continue;

			const verb = Reflect.getMetadata(METHOD_METADATA, handler as object);
			const path = [GLOBAL_PREFIX, controllerPath, methodPath]
				.filter((part) => part && part !== "/")
				.join("/")
				.replace(/\/+/g, "/");

			found.push(`${RequestMethod[verb]} ${path}`);
		}
	}

	return [...new Set(found)].sort();
}

/**
 * Cobertura de ROTAS pela bateria de contrato.
 *
 * A bateria prova que as rotas **com caso escrito** respondem conforme o
 * contrato. Isto prova o complemento: que **toda** rota exposta tem caso. Uma
 * rota nova — um `@Controller` acrescentado, um `@Post` a mais — entraria no ar
 * sem ninguém ter escrito o contrato dela, e este teste é quem acusa.
 *
 * Este arquivo se chamava `route-parity` e comparava as rotas do Nest contra as
 * do Express. Com o Express removido não há contra o que comparar; o que
 * sobrevive é a cobertura, que nunca dependeu dos dois apps.
 */
describe("contract coverage of the exposed routes", () => {
	let app: NestExpressApplication;
	let routes: string[];

	beforeAll(async () => {
		setContractEnv();
		app = await createContractNestApp();
		routes = declaredRoutes(app);
	});

	afterAll(async () => {
		await app?.close();
	});

	it("reads the routes the controllers declare", () => {
		// Sem isto, os testes abaixo passariam varrendo uma lista vazia — e a
		// leitura depende de metadata, que some se o transform perder decorators.
		expect(routes).toContain(`GET ${HEALTH_ROUTE}`);
		expect(routes.length).toBeGreaterThan(1);
	});

	it("applies the configured HTTP server timeout", () => {
		// `configureNestApp` aplica isto lendo do ConfigService. Sem afirmar
		// aqui, a configuração poderia sumir e só apareceria em produção: uma
		// lista grande estourando o default de 2 minutos do Node.
		const expected = Number(process.env.SERVER_TIMEOUT_MS) || 10 * 60 * 1000;

		expect(app.getHttpServer().timeout).toBe(expected);
	});

	it("has a contract case for every business route", () => {
		// Uma rota sem caso de contrato é uma rota cujo comportamento ninguém fixou.
		const covered = new Set(CONTRACT_ROUTES);
		const uncovered = routes
			.map((entry) => entry.split(" ")[1])
			.filter((path) => path !== HEALTH_ROUTE && !covered.has(path));

		expect(uncovered).toEqual([]);
	});
});
