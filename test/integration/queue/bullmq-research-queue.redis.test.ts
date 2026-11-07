import { Queue, UnrecoverableError } from "bullmq";
import { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import {
	type BullmqResearchQueue,
	createBullmqResearchQueue,
	RESEARCH_QUEUE_NAME,
} from "@/infrastructure/background/bullmq-research-queue.js";

/**
 * A fila contra um Redis de verdade. **Opcional**: só roda com
 * `QUEUE_REDIS_TEST_URL`, porque o CI não tem Redis e a suíte não pode depender
 * de um. É o único teste que prova o que os dublês não provam — que o job
 * interrompido por um desligamento volta para a fila e roda de novo noutra
 * instância, sem consumir tentativa.
 *
 * Use um banco descartável: o teste faz `FLUSHDB` nele.
 *
 *   docker run -d --name redis-queue-test -p 6390:6379 redis:7.4-alpine
 *   QUEUE_REDIS_TEST_URL=redis://127.0.0.1:6390/15 npx vitest run test/integration/queue
 */
const url = process.env.QUEUE_REDIS_TEST_URL;

const request: ResearchGamesRequest = {
	gameNames: ["Half-Life"],
	criteria: resolveSearchCriteria("default", {}),
	supplierSteamId: "76561198888888888",
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

/** Simula o ciclo do Nest: bootstrap → … → beforeShutdown → shutdown. */
const stop = async (queue: BullmqResearchQueue) => {
	await queue.beforeApplicationShutdown();
	await queue.onApplicationShutdown();
};

describe.skipIf(!url)("BullmqResearchQueue against a real Redis", () => {
	let admin: Redis;
	let inspector: Queue;
	const started: BullmqResearchQueue[] = [];

	const start = (runner: {
		run: (request: ResearchGamesRequest) => Promise<void>;
		reportFailure?: ResearchGamesRunner["reportFailure"];
	}) => {
		const queue = createBullmqResearchQueue(url as string, {
			reportFailure: async () => {},
			...runner,
		});
		started.push(queue);
		return queue;
	};

	beforeEach(async () => {
		admin = new Redis(url as string);
		await admin.flushdb();
		inspector = new Queue(RESEARCH_QUEUE_NAME, {
			connection: new Redis(url as string, { maxRetriesPerRequest: null }),
		});
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(async () => {
		for (const queue of started.splice(0))
			await stop(queue).catch(() => undefined);
		await inspector.close();
		await (await inspector.client).quit().catch(() => undefined);
		await admin.quit();
		vi.restoreAllMocks();
	});

	const connected = (queue: BullmqResearchQueue) =>
		waitFor(async () => (await queue.status()) === "up");

	it("runs an enqueued request and keeps it in the execution log", async () => {
		const runner = { run: vi.fn().mockResolvedValue(undefined) };
		const queue = start(runner);
		await connected(queue);
		queue.onApplicationBootstrap();

		await queue.enqueue(request);

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		expect(runner.run).toHaveBeenCalledWith(request, expect.any(AbortSignal));
	});

	it("records a failed run with its reason, without retrying it", async () => {
		const runner = {
			run: vi.fn().mockRejectedValue(new Error("Sistema Estoque returned 500")),
		};
		vi.spyOn(console, "error").mockImplementation(() => {});
		const queue = start(runner);
		await connected(queue);
		queue.onApplicationBootstrap();

		await queue.enqueue(request);

		await waitFor(
			async () => (await inspector.getJobCounts("failed")).failed === 1,
		);
		const [failed] = await inspector.getFailed();
		expect(failed.failedReason).toBe("Sistema Estoque returned 500");
		expect(runner.run).toHaveBeenCalledTimes(1);
	});

	describe("reporting a failure", () => {
		const target = {
			webhookUrl: "http://chatbot:3000/webhooks/price-cd",
			requestUuid: "8c1f0000-0000-4000-8000-000000000000",
		};

		const stateOf = async (id: string) =>
			(await inspector.getJob(id))?.getState();

		it("reports only after the job is failed, so a resend finds it failed", async () => {
			const error = new Error("Sistema Estoque returned 500");
			let stateWhenReported: string | undefined;
			const reportFailure = vi.fn(async () => {
				stateWhenReported = await stateOf(target.requestUuid);
			});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const queue = start({
				run: vi.fn().mockRejectedValue(error),
				reportFailure,
			});
			await connected(queue);
			queue.onApplicationBootstrap();

			await queue.enqueue({ ...request, ...target });

			await waitFor(async () => reportFailure.mock.calls.length === 1);
			expect(reportFailure).toHaveBeenCalledWith(target, error);
			await waitFor(async () => stateWhenReported !== undefined);
			expect(stateWhenReported).toBe("failed");
		});

		it("reports a payload that never reaches the runner", async () => {
			const run = vi.fn();
			const reportFailure = vi.fn(async () => {});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const queue = start({ run, reportFailure });
			await connected(queue);
			queue.onApplicationBootstrap();

			await inspector.add("research", target);

			await waitFor(async () => reportFailure.mock.calls.length === 1);
			expect(reportFailure).toHaveBeenCalledWith(target, expect.any(Error));
			expect(run).not.toHaveBeenCalled();
		});

		it("reports a job over the stall limit, which the worker fails without running", async () => {
			const run = vi.fn();
			const reportFailure = vi.fn(async () => {});
			vi.spyOn(console, "error").mockImplementation(() => {});
			const queue = start({ run, reportFailure });
			await connected(queue);

			// É o que o script de travados da BullMQ grava ao passar do limite: a
			// falha adiada, com o job de volta na espera.
			await queue.enqueue({ ...request, ...target });
			await admin.hset(
				`bull:${RESEARCH_QUEUE_NAME}:${target.requestUuid}`,
				"defa",
				"job stalled more than allowable limit",
			);
			queue.onApplicationBootstrap();

			await waitFor(async () => reportFailure.mock.calls.length === 1);
			expect(reportFailure).toHaveBeenCalledWith(
				target,
				expect.any(UnrecoverableError),
			);
			expect(run).not.toHaveBeenCalled();
			expect(await stateOf(target.requestUuid)).toBe("failed");
		});

		it("does not report a job returned by the shutdown", async () => {
			const reportFailure = vi.fn(async () => {});
			let release: (error: Error) => void = () => {};
			const run = vi.fn(
				() =>
					new Promise<void>((_, reject) => {
						release = reject;
					}),
			);
			const queue = start({ run, reportFailure });
			await connected(queue);
			queue.onApplicationBootstrap();

			await queue.enqueue({ ...request, ...target });
			await waitFor(async () => run.mock.calls.length === 1);

			const stopping = queue.beforeApplicationShutdown();
			release(new Error("Target closed"));
			await stopping;

			expect(reportFailure).not.toHaveBeenCalled();
			expect(await stateOf(target.requestUuid)).toBe("delayed");
		});
	});

	it("returns the job in progress at shutdown, and the next instance runs it again", async () => {
		// Primeira instância: o job começa e fica preso, como uma pesquisa longa.
		let firstRunStarted = false;
		const firstRunner = {
			run: vi.fn(async () => {
				firstRunStarted = true;
				await new Promise(() => {});
			}),
		};
		const first = start(firstRunner);
		await connected(first);
		first.onApplicationBootstrap();
		await first.enqueue(request);
		await waitFor(async () => firstRunStarted);

		// Deploy: o processo para no meio.
		await stop(first);
		started.splice(started.indexOf(first), 1);

		const counts = await inspector.getJobCounts(
			"active",
			"delayed",
			"wait",
			"failed",
		);
		expect(counts.active + counts.failed).toBe(0);
		expect(counts.delayed + counts.wait).toBe(1);

		// Segunda instância (o container novo): o mesmo pedido roda inteiro.
		const secondRunner = { run: vi.fn().mockResolvedValue(undefined) };
		const second = start(secondRunner);
		await connected(second);
		second.onApplicationBootstrap();

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		expect(secondRunner.run).toHaveBeenCalledWith(
			request,
			expect.any(AbortSignal),
		);
		const [completed] = await inspector.getCompleted();
		// Interrupção não é tentativa: o job não gastou a única que tem.
		expect(completed.attemptsMade).toBe(1);
	});

	it("runs a request stored while no worker was consuming", async () => {
		// O lado do app da durabilidade: o pedido guardado é consumido por quem
		// subir depois. O lado do Redis (sobreviver ao restart dele) é o AOF do
		// `docker-compose.yml`, travado em `test/unit/infrastructure/docker-compose.test.ts`.
		const producerOnly = start({ run: vi.fn() });
		await connected(producerOnly);
		await producerOnly.enqueue(request);
		await stop(producerOnly);
		started.splice(started.indexOf(producerOnly), 1);

		const runner = { run: vi.fn().mockResolvedValue(undefined) };
		const consumer = start(runner);
		await connected(consumer);
		consumer.onApplicationBootstrap();

		await waitFor(
			async () => (await inspector.getJobCounts("completed")).completed === 1,
		);
		expect(runner.run).toHaveBeenCalledWith(request, expect.any(AbortSignal));
	});

	it("recognizes a request_uuid: one job while pending, and a failed one can be forgotten and run again", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const runner = {
			run: vi
				.fn()
				.mockRejectedValueOnce(new Error("Sistema Estoque returned 500"))
				.mockResolvedValue(undefined),
		};
		const queue = start(runner);
		await connected(queue);
		const withUuid = {
			...request,
			requestUuid: "8c1f0000-0000-4000-8000-000000000000",
		};

		// Dois `add` com o mesmo id antes de consumir: um job só.
		await queue.enqueue(withUuid);
		await queue.enqueue(withUuid);
		expect((await inspector.getJobCounts("wait")).wait).toBe(1);
		expect(await queue.previousRun(withUuid.requestUuid)).toBe("pending");

		queue.onApplicationBootstrap();
		await waitFor(
			async () => (await queue.previousRun(withUuid.requestUuid)) === "failed",
		);

		// Sem esquecer, um novo `add` é ignorado: é o que o use case evita.
		await queue.forget(withUuid.requestUuid);
		expect(await queue.previousRun(withUuid.requestUuid)).toBe("none");
		await queue.enqueue(withUuid);

		await waitFor(
			async () =>
				(await queue.previousRun(withUuid.requestUuid)) === "completed",
		);
		expect(runner.run).toHaveBeenCalledTimes(2);
	});
});
