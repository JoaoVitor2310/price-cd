import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BullmqConnections,
	closeQueueAndConnections,
	createBullmqConnections,
	PRODUCER_RECONNECT_CEILING_MS,
	reconnectStrategy,
	WORKER_RECONNECT_CEILING_MS,
} from "@/infrastructure/background/bullmq-connections.js";

describe("reconnectStrategy", () => {
	it("doubles the wait up to the producer ceiling", () => {
		// Enquanto o produtor não reconecta, a pesquisa é recusada: depois de uma
		// queda, o atraso máximo para voltar a aceitar é este teto.
		const producer = reconnectStrategy(PRODUCER_RECONNECT_CEILING_MS);

		expect([0, 1, 2, 3, 4, 10].map(producer)).toEqual([
			500, 1000, 2000, 4000, 5000, 5000,
		]);
	});

	it("lets the worker wait longer, since nobody is on the request", () => {
		expect(reconnectStrategy(WORKER_RECONNECT_CEILING_MS)(10)).toBe(30_000);
	});
});

describe("createBullmqConnections", () => {
	let connections: BullmqConnections | undefined;

	afterEach(async () => {
		await connections?.disconnect();
		connections = undefined;
	});

	it("reports a connection error instead of crashing the process", async () => {
		// Porta onde ninguém escuta. Sem listener de `error`, o `EventEmitter`
		// lançaria e derrubaria o processo na primeira queda do Redis.
		const events = { up: vi.fn(), down: vi.fn() };
		connections = createBullmqConnections("redis://127.0.0.1:1", events);

		await vi.waitFor(() =>
			expect(events.down).toHaveBeenCalledWith("connection", expect.any(Error)),
		);
		expect(events.up).not.toHaveBeenCalled();
	});

	it("does not call the producer ready, and refuses commands at once, while Redis is down", async () => {
		// É o que permite ao `enqueue` recusar na hora em vez de pendurar a
		// requisição: fila offline desligada no produtor.
		connections = createBullmqConnections("redis://127.0.0.1:1", {
			up: vi.fn(),
			down: vi.fn(),
		});

		expect(connections.isProducerReady()).toBe(false);
		await expect(connections.ping()).rejects.toThrow();
	});

	it("gives the worker connection the null retry limit that BullMQ requires", () => {
		connections = createBullmqConnections("redis://127.0.0.1:1", {
			up: vi.fn(),
			down: vi.fn(),
		});

		expect(connections.worker.options.maxRetriesPerRequest).toBeNull();
		expect(connections.producer.options.enableOfflineQueue).toBe(false);
	});
});

describe("closeQueueAndConnections", () => {
	it("closes the queue, then the connections", async () => {
		const calls: string[] = [];

		await closeQueueAndConnections(
			{ close: async () => void calls.push("queue") },
			async () => void calls.push("connections"),
		);

		expect(calls).toEqual(["queue", "connections"]);
	});

	it("never throws, and still disconnects when closing the queue fails", async () => {
		const disconnect = vi.fn().mockRejectedValue(new Error("gone"));

		await expect(
			closeQueueAndConnections(
				{ close: vi.fn().mockRejectedValue(new Error("already closed")) },
				disconnect,
			),
		).resolves.toBeUndefined();
		expect(disconnect).toHaveBeenCalled();
	});
});
