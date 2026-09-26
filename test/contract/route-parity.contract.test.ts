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
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTRACT_ROUTES } from "./contract-cases.js";
import { createContractNestApp, setContractEnv } from "./nest-app.js";

/** Rota que só o app Nest tem: liveness probe, o Express nunca teve. */
const NEST_ONLY = "/api/health";

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
 * Paridade de ROTAS.
 *
 * A bateria de contrato prova que as rotas **com caso escrito** respondem igual.
 * Isto prova algo complementar: que toda rota que o Nest expõe existe no Express
 * e tem caso de contrato. Uma rota que o Nest ganhasse por acidente — um
 * `@Controller` novo, um prefixo trocado — apareceria aqui, não no cutover.
 *
 * O que isto **não** cobre: uma rota que só o Express tenha e para a qual
 * ninguém escreveu caso de contrato. Essa fica com o `README.md`, que lista os
 * endpoints, e com a revisão do PR 9.
 */
describe("route parity between the two apps", () => {
	let nestApp: NestExpressApplication;
	let expressApp: Awaited<typeof import("@/app.js")>["default"];
	let routes: string[];

	beforeAll(async () => {
		setContractEnv();
		nestApp = await createContractNestApp();
		expressApp = (await import("@/app.js")).default;
		routes = declaredRoutes(nestApp);
	});

	afterAll(async () => {
		await nestApp?.close();
	});

	it("reads the routes the Nest controllers declare", () => {
		// Sem isto, os testes abaixo passariam varrendo uma lista vazia — e a
		// leitura depende de metadata, que some se o transform perder decorators.
		expect(routes).toContain(`GET ${NEST_ONLY}`);
		expect(routes.length).toBeGreaterThan(1);
	});

	it("serves every Nest route on the Express app, with the same method", async () => {
		for (const entry of routes.filter((r) => !r.endsWith(NEST_ONLY))) {
			const [method, path] = entry.split(" ");
			const response = await request(expressApp)
				[method.toLowerCase() as "get" | "post"](path)
				.send({});

			// 404 = a rota não existe. 405 = existe com outro método, que num
			// cutover quebra o cliente do mesmo jeito.
			expect(
				response.status,
				`${entry} is missing from the Express app`,
			).not.toBe(404);
			expect(
				response.status,
				`${entry} exists on Express with a different method`,
			).not.toBe(405);
		}
	});

	it("applies the same HTTP server timeout the Express app uses", () => {
		// `configureNestApp` aplica isto lendo do ConfigService. Sem afirmar
		// aqui, a configuração poderia sumir e só apareceria em produção: uma
		// lista grande estourando o default de 2 minutos do Node.
		const expected = Number(process.env.SERVER_TIMEOUT_MS) || 10 * 60 * 1000;

		expect(nestApp.getHttpServer().timeout).toBe(expected);
	});

	it("has a contract case for every business route", () => {
		// Uma rota sem caso de contrato é uma rota cuja paridade ninguém provou.
		const covered = new Set(CONTRACT_ROUTES);
		const uncovered = routes
			.map((entry) => entry.split(" ")[1])
			.filter((path) => path !== NEST_ONLY && !covered.has(path));

		expect(uncovered).toEqual([]);
	});
});
