import { DelayedError } from "bullmq";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { ResearchQueueUnavailableError } from "@/application/games/ports/research-queue.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import type {
	BullmqJob,
	BullmqJobProcessor,
} from "@/infrastructure/background/bullmq-clients.js";
import {
	BullmqResearchQueue,
	RESEARCH_JOB_OPTIONS,
} from "@/infrastructure/background/bullmq-research-queue.js";

const request: ResearchGamesRequest = {
	gameNames: ["Half-Life", "Portal 2"],
	criteria: resolveSearchCriteria("default", { checkGamivoOffer: true }),
	supplierSteamId: "76561198888888888",
	listCode: "G0eXM",
	title: "Trade from supplier X",
};

/**
 * Monta o adapter com dublês da BullMQ e devolve o processador que ele
 * entregou ao worker — é por ele que os testes simulam um job chegando.
 */
function setup(runner = { run: vi.fn().mockResolvedValue(undefined) }) {
	const calls: string[] = [];
	const queue = {
		add: vi.fn().mockResolvedValue({ id: "1" }),
		close: vi.fn(async () => {
			calls.push("queue.close");
		}),
	};
	const worker = {
		run: vi.fn(() => new Promise<void>(() => {})),
		close: vi.fn(async (_force?: boolean) => {
			calls.push("worker.close");
		}),
	};
	let processor: BullmqJobProcessor | undefined;
	const deps = {
		queue,
		ping: vi.fn().mockResolvedValue("PONG"),
		isConnected: vi.fn(() => true),
		disconnect: vi.fn(async () => {
			calls.push("disconnect");
		}),
		createWorker: vi.fn((p: BullmqJobProcessor) => {
			processor = p;
			return worker;
		}),
	};

	const adapter = new BullmqResearchQueue(deps, runner);
	if (!processor) throw new Error("the adapter did not create its worker");

	const job = (data: unknown = request): BullmqJob => ({
		id: "42",
		data,
		moveToDelayed: vi.fn(async () => {
			calls.push("job.moveToDelayed");
		}),
	});

	return {
		adapter,
		deps,
		queue,
		worker,
		runner,
		process: processor,
		job,
		calls,
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("BullmqResearchQueue", () => {
	describe("enqueue", () => {
		it("stores the request as job data, with the execution-log retention", async () => {
			const { adapter, queue } = setup();

			await adapter.enqueue(request);

			expect(queue.add).toHaveBeenCalledWith(
				"research",
				request,
				RESEARCH_JOB_OPTIONS,
			);
		});

		it("keeps finished jobs by age, and never retries a research on its own", () => {
			// Repetir uma pesquisa que já chamou o Estoque pode criar outra Trade:
			// sem `attempts`, a BullMQ tenta uma vez só.
			expect(RESEARCH_JOB_OPTIONS.attempts).toBeUndefined();
			expect(RESEARCH_JOB_OPTIONS.removeOnComplete).toEqual({
				age: 7 * 24 * 3600,
			});
			expect(RESEARCH_JOB_OPTIONS.removeOnFail).toEqual({
				age: 30 * 24 * 3600,
			});
		});

		it("refuses at once when Redis is not connected, instead of hanging the request", async () => {
			// O `add` da BullMQ espera a conexão: chamá-lo com o Redis fora
			// pendura a requisição até o Redis voltar.
			const { adapter, deps, queue } = setup();
			deps.isConnected.mockReturnValue(false);
			vi.spyOn(console, "warn").mockImplementation(() => {});

			await expect(adapter.enqueue(request)).rejects.toBeInstanceOf(
				ResearchQueueUnavailableError,
			);
			expect(queue.add).not.toHaveBeenCalled();
		});

		it("gives up on a connected but stuck Redis", async () => {
			vi.useFakeTimers();
			const { adapter, queue } = setup();
			queue.add.mockReturnValue(new Promise(() => {}));

			const enqueued = expect(adapter.enqueue(request)).rejects.toThrow(
				/timed out/,
			);
			await vi.advanceTimersByTimeAsync(5000);
			await enqueued;
		});

		it("propagates a failure to store, so the request is not answered with 202", async () => {
			const { adapter, queue } = setup();
			queue.add.mockRejectedValue(
				new Error(
					"Stream isn't writeable and enableOfflineQueue options is false",
				),
			);

			await expect(adapter.enqueue(request)).rejects.toThrow(
				"enableOfflineQueue",
			);
		});
	});

	describe("status", () => {
		it("is up when Redis answers the ping", async () => {
			const { adapter } = setup();

			expect(await adapter.status()).toBe("up");
		});

		it("is down when the ping fails, warning once per outage", async () => {
			const { adapter, deps } = setup();
			vi.spyOn(console, "log").mockImplementation(() => {});
			adapter.reportUp(); // já tinha conectado
			deps.ping.mockRejectedValue(new Error("Connection is closed."));
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			expect(await adapter.status()).toBe("down");
			expect(await adapter.status()).toBe("down");

			expect(warn).toHaveBeenCalledTimes(1);
		});

		it("does not call a ping before the first connection an outage", async () => {
			// O primeiro health do boot chega antes da conexão sair: logava "ping
			// failed" e, milissegundos depois, "responding again".
			const { adapter, deps } = setup();
			deps.ping.mockRejectedValue(new Error("Stream isn't writeable"));
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			expect(await adapter.status()).toBe("down");
			expect(warn).not.toHaveBeenCalled();
		});

		it("warns about a connection error even before the first connection", () => {
			// Redis fora no boot: é o erro de conexão que avisa.
			const { adapter } = setup();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			adapter.reportDown("connection", new Error("connect ECONNREFUSED"));

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("ECONNREFUSED"),
			);
		});

		it("says connected on the first connection and back on after an outage", () => {
			const { adapter } = setup();
			const log = vi.spyOn(console, "log").mockImplementation(() => {});
			vi.spyOn(console, "warn").mockImplementation(() => {});

			adapter.reportUp();
			adapter.reportDown("connection", new Error("ECONNRESET"));
			adapter.reportUp();

			expect(log.mock.calls.map(([line]) => line)).toEqual([
				expect.stringContaining("Redis connected"),
				expect.stringContaining("responding again"),
			]);
		});

		it("is down when Redis is too slow to answer", async () => {
			vi.useFakeTimers();
			const { adapter, deps } = setup();
			deps.ping.mockReturnValue(new Promise(() => {}));
			vi.spyOn(console, "warn").mockImplementation(() => {});

			const status = adapter.status();
			await vi.advanceTimersByTimeAsync(1000);

			expect(await status).toBe("down");
		});
	});

	describe("consuming", () => {
		it("starts the worker only at application bootstrap", () => {
			const { adapter, worker } = setup();
			expect(worker.run).not.toHaveBeenCalled();

			adapter.onApplicationBootstrap();

			expect(worker.run).toHaveBeenCalledTimes(1);
		});

		it("runs the research with the request stored in the job", async () => {
			const { process, job, runner } = setup();

			await process(job(), "token");

			expect(runner.run).toHaveBeenCalledWith(request);
		});

		it("lets a runner failure fail the job, so it is recorded", async () => {
			const { process, job, runner } = setup();
			runner.run.mockRejectedValue(new Error("Sistema Estoque returned 500"));

			await expect(process(job(), "token")).rejects.toThrow(
				"Sistema Estoque returned 500",
			);
		});

		it("fails a job whose payload does not match, without running anything", async () => {
			const { process, job, runner } = setup();

			await expect(process(job({ gameNames: [] }), "token")).rejects.toThrow(
				/Invalid research job payload/,
			);
			expect(runner.run).not.toHaveBeenCalled();
		});
	});

	describe("shutdown", () => {
		it("returns the job in progress to the queue, then closes the worker without waiting", async () => {
			let finishRun: ((error?: Error) => void) | undefined;
			const runner = {
				run: vi.fn(
					() =>
						new Promise<void>((resolve, reject) => {
							finishRun = (error) => (error ? reject(error) : resolve());
						}),
				),
			};
			const { adapter, process, job, worker, calls } = setup(runner);
			vi.spyOn(console, "log").mockImplementation(() => {});
			const activeJob = job();

			const processing = process(activeJob, "lock-token");
			await adapter.beforeApplicationShutdown();

			expect(activeJob.moveToDelayed).toHaveBeenCalledWith(
				expect.any(Number),
				"lock-token",
			);
			expect(worker.close).toHaveBeenCalledWith(true);
			expect(calls).toEqual(["job.moveToDelayed", "worker.close"]);

			// O browser fecha depois: a falha que isso causa não é do pedido, e
			// `DelayedError` diz à BullMQ para não marcar o job como falho.
			finishRun?.(new Error("Target closed"));
			await expect(processing).rejects.toBeInstanceOf(DelayedError);
		});

		it("warns when a returned job still finishes, because it will run again", async () => {
			let finishRun: (() => void) | undefined;
			const runner = {
				run: vi.fn(
					() =>
						new Promise<void>((resolve) => {
							finishRun = resolve;
						}),
				),
			};
			const { adapter, process, job } = setup(runner);
			vi.spyOn(console, "log").mockImplementation(() => {});
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

			const processing = process(job(), "lock-token");
			await adapter.beforeApplicationShutdown();
			finishRun?.();

			await expect(processing).rejects.toBeInstanceOf(DelayedError);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("it will run again"),
			);
		});

		it("only closes the worker when nothing is running", async () => {
			const { adapter, worker, calls } = setup();

			await adapter.beforeApplicationShutdown();

			expect(worker.close).toHaveBeenCalledWith(true);
			expect(calls).toEqual(["worker.close"]);
		});

		it("still closes the worker when the job cannot be returned, leaving it to stalled recovery", async () => {
			const runner = { run: vi.fn(() => new Promise<void>(() => {})) };
			const { adapter, process, job, worker } = setup(runner);
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const activeJob = job();
			vi.mocked(activeJob.moveToDelayed).mockRejectedValue(
				new Error("Connection is closed."),
			);

			void process(activeJob, "lock-token");
			await adapter.beforeApplicationShutdown();

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("recovered as stalled"),
			);
			expect(worker.close).toHaveBeenCalledWith(true);
		});

		it("lets a job that could not be returned complete normally if it finishes", async () => {
			// Devolução falhou (Redis fora no desligamento) e a pesquisa terminou:
			// a Trade já foi criada. Lançar `DelayedError` aqui deixaria o job
			// ativo, ele voltaria como travado e criaria a Trade de novo.
			let finishRun: (() => void) | undefined;
			const runner = {
				run: vi.fn(
					() =>
						new Promise<void>((resolve) => {
							finishRun = resolve;
						}),
				),
			};
			const { adapter, process, job } = setup(runner);
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const activeJob = job();
			vi.mocked(activeJob.moveToDelayed).mockRejectedValue(
				new Error("Connection is closed."),
			);

			const processing = process(activeJob, "lock-token");
			await adapter.beforeApplicationShutdown();
			finishRun?.();

			await expect(processing).resolves.toBeUndefined();
		});

		it("returns a job picked after shutdown began without running it", async () => {
			// Entre o `shuttingDown = true` e o `close(true)` o worker ainda busca
			// job: rodá-lo seria começar uma pesquisa que o browser fechando derruba.
			const { adapter, process, job, runner } = setup();
			await adapter.beforeApplicationShutdown();
			const lateJob = job();

			await expect(process(lateJob, "lock-token")).rejects.toBeInstanceOf(
				DelayedError,
			);
			expect(lateJob.moveToDelayed).toHaveBeenCalledWith(
				expect.any(Number),
				"lock-token",
			);
			expect(runner.run).not.toHaveBeenCalled();
		});

		it("leaves a late job to stalled recovery when it cannot be returned", async () => {
			const { adapter, process, job, runner } = setup();
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			await adapter.beforeApplicationShutdown();
			const lateJob = job();
			vi.mocked(lateJob.moveToDelayed).mockRejectedValue(
				new Error("Connection is closed."),
			);

			await expect(process(lateJob, "lock-token")).rejects.toBeInstanceOf(
				DelayedError,
			);
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining("recovered as stalled"),
			);
			expect(runner.run).not.toHaveBeenCalled();
		});

		it("closes the queue and its connections at application shutdown, never throwing", async () => {
			const { adapter, queue, deps, calls } = setup();
			queue.close.mockRejectedValue(new Error("already closed"));

			await expect(adapter.onApplicationShutdown()).resolves.toBeUndefined();

			expect(queue.close).toHaveBeenCalled();
			expect(deps.disconnect).toHaveBeenCalled();
			expect(calls).toContain("disconnect");
		});
	});
});
