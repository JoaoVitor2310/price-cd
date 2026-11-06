import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type BullmqWebhookQueue,
	createBullmqWebhookQueue,
	WEBHOOK_QUEUE_NAME,
} from "@/infrastructure/background/bullmq-webhook-queue.js";
import type { WebhookBody } from "@/infrastructure/webhooks/webhook-body.js";

/**
 * A fila de webhooks contra um Redis de verdade. **Opcional**, como a da
 * pesquisa: só roda com `QUEUE_REDIS_TEST_URL` (ver o outro arquivo desta pasta).
 *
 * Prova o que os dublês não provam: que a BullMQ deduplica pelo `jobId`, que um
 * resultado concluído volta a ser entregue, e que a espera da nova tentativa é
 * a nossa (30s), não a padrão.
 */
const baseUrl = process.env.QUEUE_REDIS_TEST_URL;

/**
 * Um banco **vizinho** ao do teste da fila da pesquisa: o Vitest roda os
 * arquivos em paralelo, e o `FLUSHDB` de um apagaria os jobs do outro.
 */
const url = (() => {
	if (!baseUrl) return undefined;
	const parsed = new URL(baseUrl);
	const db = Number(parsed.pathname.slice(1) || 0);
	parsed.pathname = `/${db > 0 ? db - 1 : db + 1}`;
	return parsed.toString();
})();

const REQUEST_UUID = "8c1f0000-0000-4000-8000-000000000000";
const target = {
	webhookUrl: "http://chatbot:3000/webhooks/price-cd",
	requestUuid: REQUEST_UUID,
};

const waitFor = async (
	condition: () => Promise<boolean>,
	timeoutMs = 10_000,
) => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("condition not met in time");
};

describe.skipIf(!url)("BullmqWebhookQueue against a real Redis", () => {
	let admin: Redis;
	let inspector: Queue;
	const started: BullmqWebhookQueue[] = [];

	const start = (send: (url: string, body: WebhookBody) => Promise<void>) => {
		const queue = createBullmqWebhookQueue(url as string, {
			send: vi.fn(send),
		});
		started.push(queue);
		return queue;
	};

	beforeEach(async () => {
		admin = new Redis(url as string);
		await admin.flushdb();
		inspector = new Queue(WEBHOOK_QUEUE_NAME, {
			connection: new Redis(url as string, { maxRetriesPerRequest: null }),
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(async () => {
		for (const queue of started.splice(0)) {
			await queue.beforeApplicationShutdown().catch(() => undefined);
			await queue.onApplicationShutdown().catch(() => undefined);
		}
		await inspector.close();
		await (await inspector.client).quit().catch(() => undefined);
		await admin.quit();
		vi.restoreAllMocks();
	});

	const ready = async () => {
		const probe = new Redis(url as string);
		await probe.ping();
		await probe.quit();
		// O produtor conecta em segundo plano; um `notify` cedo demais é recusado.
		await new Promise((resolve) => setTimeout(resolve, 200));
	};

	it("delivers one result per request: a second notify with the same uuid is ignored", async () => {
		const sent: WebhookBody[] = [];
		const queue = start(async (_url, body) => {
			sent.push(body);
		});
		await ready();

		await queue.notify(target, { result: "trade_created", tradeUuid: "3a9e" });
		await queue.notify(target, { result: "no_trade" });
		queue.onApplicationBootstrap();

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		expect(sent).toEqual([
			{
				request_uuid: REQUEST_UUID,
				result: "trade_created",
				trade_uuid: "3a9e",
			},
		]);
	});

	it("delivers a completed result again on redeliver", async () => {
		let deliveries = 0;
		const queue = start(async () => {
			deliveries++;
		});
		await ready();
		queue.onApplicationBootstrap();

		await queue.notify(target, { result: "no_trade" });
		await waitFor(async () => deliveries === 1);
		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);

		await expect(queue.redeliver(REQUEST_UUID)).resolves.toBe(true);
		await waitFor(async () => deliveries === 2);
	});

	it("waits our 30s before the second attempt, not BullMQ's default", async () => {
		const queue = start(async () => {
			throw new Error("Webhook answered HTTP 503");
		});
		await ready();
		queue.onApplicationBootstrap();

		const before = Date.now();
		await queue.notify(target, { result: "no_trade" });
		await waitFor(
			async () => (await inspector.getJobCounts("delayed")).delayed === 1,
		);

		const [job] = await inspector.getDelayed();
		expect(job.attemptsMade).toBe(1);
		// O score do conjunto `delayed` é o instante da próxima tentativa (× 4096
		// na BullMQ 5, para caber um contador nos bits baixos).
		const score = Number(
			await admin.zscore(inspector.toKey("delayed"), job.id as string),
		);
		const nextAttemptIn = Math.floor(score / 0x1000) - before;
		expect(nextAttemptIn).toBeGreaterThanOrEqual(29_000);
		expect(nextAttemptIn).toBeLessThanOrEqual(32_000);
	});

	it("forgets a result waiting for its next attempt, so a new one can be notified", async () => {
		const sent: WebhookBody[] = [];
		let fail = true;
		const queue = start(async (_url, body) => {
			if (fail) throw new Error("Webhook answered HTTP 503");
			sent.push(body);
		});
		await ready();
		queue.onApplicationBootstrap();

		await queue.notify(target, {
			result: "failed",
			failure: { kind: "stock_unavailable", message: "x" },
		});
		await waitFor(
			async () => (await inspector.getJobCounts("delayed")).delayed === 1,
		);

		await queue.forget(REQUEST_UUID);
		fail = false;
		await queue.notify(target, { result: "trade_created", tradeUuid: "3a9e" });

		await waitFor(async () => sent.length === 1);
		expect(sent[0]).toMatchObject({ result: "trade_created" });
	});
});
