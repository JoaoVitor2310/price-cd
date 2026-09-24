import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";

/**
 * Paridade de boot com o Express.
 *
 * O Express sobe sem `SISTEMA_ESTOQUE_URL` e continua servindo
 * `/api/games/research` em modo demonstração — que não cria Trade nenhuma. O
 * app Nest chegou a perder isso: construir o `HttpGameTradeImporter` no boot
 * derrubava o processo inteiro por causa de uma integração que metade das rotas
 * não usa. O CI pegou; estes testes impedem a volta.
 */
describe("booting without the inventory system configured", () => {
	let app: NestExpressApplication;
	const saved = {
		url: process.env.SISTEMA_ESTOQUE_URL,
		secret: process.env.EXTERNAL_SECRET,
	};

	beforeEach(async () => {
		delete process.env.SISTEMA_ESTOQUE_URL;
		delete process.env.EXTERNAL_SECRET;

		const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
			.overrideProvider(PopularityFetcher)
			.useValue({ fetch: async () => [] })
			.overrideProvider(PriceFetcher)
			.useValue({ fetch: async () => [] })
			.compile();

		app = moduleRef.createNestApplication<NestExpressApplication>();
		configureNestApp(app);
		await app.init();
	});

	afterEach(async () => {
		await app?.close();
		if (saved.url === undefined) delete process.env.SISTEMA_ESTOQUE_URL;
		else process.env.SISTEMA_ESTOQUE_URL = saved.url;
		if (saved.secret === undefined) delete process.env.EXTERNAL_SECRET;
		else process.env.EXTERNAL_SECRET = saved.secret;
	});

	it("boots at all", () => {
		expect(app).toBeDefined();
	});

	it("still serves the demo path", async () => {
		const response = await request(app.getHttpServer())
			.post("/api/games/research")
			.send({ minPopularity: 0, gameNames: ["Hades"], checkGamivoOffer: false });

		expect(response.status).toBe(200);
		expect(response.body.demo).toBe(true);
	});

	it("fails the authenticated path inside the request, not in the background", async () => {
		// Enfileirar e só então descobrir que falta configuração perderia o erro:
		// depois do 202 não há mais ninguém para recebê-lo.
		process.env.INTERNAL_SECRET = "secret";

		const response = await request(app.getHttpServer())
			.post("/api/games/research")
			.send({
				minPopularity: 0,
				gameNames: ["Hades"],
				checkGamivoOffer: false,
				internal_secret: "secret",
			});

		expect(response.status).toBe(500);
		expect(response.body.details).toContain("SISTEMA_ESTOQUE_URL");
		delete process.env.INTERNAL_SECRET;
	});
});
