import "reflect-metadata";
import { vi } from "vitest";

/**
 * Antes de qualquer import: a allowlist do webhook passa por `transform` no
 * schema do ambiente, que é validado no import do `ConfigModule` e fica congelado
 * (`test/setup.ts` conta a história). Num `beforeAll` não teria efeito.
 */
vi.hoisted(() => {
	process.env.INTERNAL_SECRET = "topic-test-secret";
	process.env.WEBHOOK_ALLOWED_HOSTS = "chatbot";
	process.env.WEBHOOK_SIGNING_SECRET = "topic-test-webhook-secret-32-chars";
});

import type { NestExpressApplication } from "@nestjs/platform-express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ResearchQueue } from "@/application/games/ports/research-queue.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import {
	createContractNestApp,
	setContractEnv,
} from "../../contract/nest-app.js";

const REQUEST_UUID = "8c1f0000-0000-4000-8000-000000000000";

describe("POST /api/games/research/from-topic", () => {
	let app: NestExpressApplication;

	beforeAll(async () => {
		setContractEnv();
		app = await createContractNestApp();
	});

	afterAll(async () => {
		await app.close();
	});

	it("answers 202 and queues the request, without scraping in the request", async () => {
		const response = await request(app.getHttpServer())
			.post("/api/games/research/from-topic")
			.send({
				topic_url: "https://www.steamtrades.com/trade/wGVYD/h-games-w-tf2",
				steam_id: "76561198012345678",
				currency: "tf2",
				request_uuid: REQUEST_UUID,
				webhook_url: "http://chatbot:3000/webhooks/price-cd",
				internal_secret: "topic-test-secret",
			});

		expect(response.status).toBe(202);
		expect(response.body).toEqual({ success: true, status: "queued" });

		const queue = app.get(ResearchQueue) as unknown as { enqueued: unknown[] };
		expect(queue.enqueued).toEqual([
			{
				topicUrl: "https://www.steamtrades.com/trade/wGVYD/h-games-w-tf2",
				listCode: "wGVYD",
				supplierSteamId: "76561198012345678",
				currency: "tf2",
				requestUuid: REQUEST_UUID,
				webhookUrl: "http://chatbot:3000/webhooks/price-cd",
				criteria: resolveSearchCriteria("lists", {}),
			},
		]);
	});
});
