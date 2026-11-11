import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	LISTS_QUEUE_NAME,
	QUEUE_NAMES,
} from "@/infrastructure/background/queue-names.js";
import {
	QUEUE_DASHBOARD_PATH,
	QueueDashboard,
} from "@/nest/queue-dashboard/queue-dashboard.js";
import { queueTestUrl } from "./queue-test-db.js";

/**
 * O painel das filas (ADR 0011) contra um Redis de verdade. **Opcional**, como os
 * outros testes de fila: só roda com `QUEUE_REDIS_TEST_URL` e faz `FLUSHDB` no
 * banco dele (`queue-test-db.ts`).
 */
const url = queueTestUrl(3);

const USER = "ops";
const PASSWORD = "a-long-enough-password";
const auth = (user = USER, password = PASSWORD) =>
	`Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe.skipIf(!url)("QueueDashboard against a real Redis", () => {
	let app: NestExpressApplication;
	let dashboard: QueueDashboard;
	let admin: Redis;

	beforeEach(async () => {
		admin = new Redis(url as string);
		await admin.flushdb();
		vi.spyOn(console, "log").mockImplementation(() => {});

		const moduleRef = await Test.createTestingModule({}).compile();
		app = moduleRef.createNestApplication<NestExpressApplication>({
			logger: false,
		});
		dashboard = new QueueDashboard({
			redisUrl: url as string,
			user: USER,
			password: PASSWORD,
		});
		dashboard.mount(app);
		await app.init();
	});

	afterEach(async () => {
		await app.close();
		await dashboard.onApplicationShutdown();
		await admin.quit();
		vi.restoreAllMocks();
	});

	it("asks for credentials, on the page and on its API", async () => {
		for (const path of ["", "/api/queues"]) {
			const response = await request(app.getHttpServer()).get(
				`${QUEUE_DASHBOARD_PATH}${path}`,
			);

			expect(response.status).toBe(401);
			expect(response.headers["www-authenticate"]).toContain("Basic");
		}
	});

	it("refuses a wrong password", async () => {
		const response = await request(app.getHttpServer())
			.get(QUEUE_DASHBOARD_PATH)
			.set("Authorization", auth(USER, "wrong-password-here"));

		expect(response.status).toBe(401);
	});

	it("serves the page to the configured user", async () => {
		const response = await request(app.getHttpServer())
			.get(QUEUE_DASHBOARD_PATH)
			.set("Authorization", auth());

		expect(response.status).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
	});

	it("lists the four queues, every one read-only, with what is in them", async () => {
		const lists = new Queue(LISTS_QUEUE_NAME, {
			connection: new Redis(url as string, { maxRetriesPerRequest: null }),
		});
		await lists.add("run-lists", { steam_id: "76561198000000001" });

		const response = await request(app.getHttpServer())
			.get(`${QUEUE_DASHBOARD_PATH}/api/queues`)
			.set("Authorization", auth());

		expect(response.status).toBe(200);
		const queues: Array<{
			name: string;
			readOnlyMode: boolean;
			counts: Record<string, number>;
		}> = response.body.queues;
		expect(queues.map((queue) => queue.name).sort()).toEqual(
			[...QUEUE_NAMES].sort(),
		);
		expect(queues.every((queue) => queue.readOnlyMode)).toBe(true);
		expect(
			queues.find((queue) => queue.name === LISTS_QUEUE_NAME)?.counts.waiting,
		).toBe(1);

		await lists.close();
		await (await lists.client).quit();
	});

	it("refuses to retry a job from the panel, on the server", async () => {
		// Repetir um Reabastecimento cria outra Trade (ADR 0009): o botão some da
		// interface, e a rota responde 405 mesmo chamada direto.
		const response = await request(app.getHttpServer())
			.put(
				`${QUEUE_DASHBOARD_PATH}/api/queues/${LISTS_QUEUE_NAME}/retry/failed`,
			)
			.set("Authorization", auth());

		expect(response.status).toBe(405);
	});
});
