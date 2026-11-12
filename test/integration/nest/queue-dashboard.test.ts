import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { QueueDashboard } from "@/nest/queue-dashboard/queue-dashboard.js";
import {
	createContractNestApp,
	setContractEnv,
} from "../../contract/nest-app.js";

/**
 * O app inteiro, como a suíte roda: sem `QUEUE_REDIS_URL` nem credenciais do
 * painel. O painel montado com Redis está em
 * `test/integration/queue/queue-dashboard.redis.test.ts`.
 */
describe("Queue dashboard in the app", () => {
	let app: NestExpressApplication;

	beforeAll(async () => {
		setContractEnv();
		app = await createContractNestApp();
	});

	afterAll(async () => {
		await app?.close();
	});

	it("is wired into the container", () => {
		expect(app.get(QueueDashboard)).toBeInstanceOf(QueueDashboard);
	});

	it("does not exist without credentials: the route is a 404, not an open panel", async () => {
		const response = await request(app.getHttpServer()).get(
			"/api/admin/queues",
		);

		expect(response.status).toBe(404);
	});
});
