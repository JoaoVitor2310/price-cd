import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";
import { HealthController } from "@/nest/health/health.controller.js";

describe("Nest app skeleton", () => {
	let app: NestExpressApplication;

	beforeAll(async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleRef.createNestApplication<NestExpressApplication>();
		configureNestApp(app);
		await app.init();
	});

	afterAll(async () => {
		await app?.close();
	});

	it("emits design:paramtypes — without it the container injects undefined silently", () => {
		// A asserção direta, sem intermediários. No spike do PR 0 um teste que só
		// resolvia o provider pelo token passava mesmo COM a metadata ausente:
		// é por isso que esta checagem existe separada da de HTTP.
		const paramTypes = Reflect.getMetadata("design:paramtypes", HealthController);

		expect(paramTypes, "metadata missing: the transform is not SWC").toBeDefined();
		expect(paramTypes[0]).toBe(ConfigService);
	});

	it("answers GET /api/health with the environment resolved by ConfigService", async () => {
		const response = await request(app.getHttpServer()).get("/api/health");

		expect(response.status).toBe(200);
		expect(response.body).toMatchObject({ status: "ok", app: "nest" });
		// Prova que a injeção chegou de verdade: `env` vem do ConfigService, e um
		// `undefined` injetado daria 500 em vez de 200.
		expect(response.body.env).toBeTruthy();
	});

	it("declares AllExceptionsFilter through APP_FILTER, not useGlobalFilters", () => {
		// Não dá para resolver `APP_FILTER` com `app.get()`: o Nest guarda
		// enhancers numa lista interna, fora do contexto resolvível. Então o que
		// este teste trava é a DECLARAÇÃO — e é justamente ela que importa, porque
		// trocar por `app.useGlobalFilters()` tiraria o filter da DI sem quebrar
		// nenhuma resposta hoje, só no dia em que ele precisasse injetar algo.
		const providers = Reflect.getMetadata("providers", AppModule) as Array<{
			provide?: unknown;
			useClass?: unknown;
		}>;

		expect(providers).toEqual(
			expect.arrayContaining([
				{ provide: APP_FILTER, useClass: AllExceptionsFilter },
			]),
		);
	});

	it("keeps the Express 404 response for an unknown route", () => {
		// Paridade com a bateria de contrato: o filter deixa `HttpException`
		// passar com o corpo original, então o 404 do Nest não ganha envelope
		// `{ success }` que o Express não tem.
		return request(app.getHttpServer())
			.post("/api/does-not-exist")
			.expect(404)
			.expect((response) => {
				expect(response.body.success).toBeUndefined();
			});
	});
});
