import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupplierDiscoveryQueue } from "@/application/suppliers/ports/supplier-discovery-queue.port.js";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/use-cases/enqueue-find-new-suppliers.use-case.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { SuppliersModule } from "@/nest/suppliers/suppliers.module.js";
import { SUPPLIERS_RUNNER } from "@/nest/suppliers/suppliers.tokens.js";

/**
 * O wiring da fila da Descoberta. A suíte roda sem `QUEUE_REDIS_URL`, então a
 * fila é a em memória; a durável está em `bullmq-job-queue.redis.test.ts`.
 */
describe("SuppliersModule", () => {
	const SUPPLIERS_ENV = [
		"STEAMTRADES_SESSION",
		"SISTEMA_ESTOQUE_URL",
		"EXTERNAL_SECRET",
	] as const;
	const savedEnv = Object.fromEntries(
		SUPPLIERS_ENV.map((key) => [key, process.env[key]]),
	);

	afterEach(() => {
		vi.restoreAllMocks();
		// Um caso define o ambiente da Descoberta; os seguintes não podem herdá-lo.
		for (const key of SUPPLIERS_ENV) {
			if (savedEnv[key] === undefined) delete process.env[key];
			else process.env[key] = savedEnv[key];
		}
	});

	it("runs the discovery requested through the use case, in the background", async () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const runner = {
			run: vi.fn().mockResolvedValue({
				pagesVisited: 1,
				topicsProcessed: 0,
				suppliersCommented: 0,
			}),
		};
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, SuppliersModule],
		})
			.overrideProvider(SUPPLIERS_RUNNER)
			.useValue(runner)
			.compile();

		await moduleRef.get(EnqueueFindNewSuppliersUseCase).execute();

		await vi.waitFor(() => expect(runner.run).toHaveBeenCalledTimes(1));
		await moduleRef.close();
	});

	it("answers 500 in the route's shape when the queue cannot store the request", async () => {
		// Antes da fila durável era sempre 202, e um restart perdia o pedido.
		process.env.STEAMTRADES_SESSION = "test-session";
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
		process.env.EXTERNAL_SECRET = "test-external-secret";
		vi.spyOn(console, "log").mockImplementation(() => {});
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, SuppliersModule],
		})
			.overrideProvider(SupplierDiscoveryQueue)
			.useValue({
				enqueue: vi
					.fn()
					.mockRejectedValue(
						new Error("Suppliers queue unavailable: Redis is not connected"),
					),
			})
			.compile();
		const app = moduleRef.createNestApplication<NestExpressApplication>();
		app.useLogger(false);
		await app.init();

		const response = await request(app.getHttpServer()).post(
			"/suppliers/find-new",
		);

		expect(response.status).toBe(500);
		expect(response.body).toEqual({
			error: "Suppliers queue unavailable: Redis is not connected",
		});
		await app.close();
	});

	it("hands the use case the queue registered under the port", async () => {
		const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, SuppliersModule],
		})
			.overrideProvider(SupplierDiscoveryQueue)
			.useValue(queue)
			.compile();

		await moduleRef.get(EnqueueFindNewSuppliersUseCase).execute();

		expect(queue.enqueue).toHaveBeenCalledWith({
			requestedAt: expect.any(String),
		});
		await moduleRef.close();
	});
});
