import { afterEach, describe, expect, it, vi } from "vitest";
import { BullmqConnectionLog } from "@/infrastructure/background/bullmq-connection-log.js";

const messages = {
	connected: "connected",
	back: "back",
	down: (operation: string, reason: string) => `down: ${operation} (${reason})`,
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("BullmqConnectionLog", () => {
	it("says connected once, on the first connection", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const connection = new BullmqConnectionLog(messages);

		connection.up();
		connection.up();

		expect(log.mock.calls).toEqual([["connected"]]);
	});

	it("can stay silent on the first connection", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const { connected: _connected, ...withoutConnected } = messages;

		new BullmqConnectionLog(withoutConnected).up();

		expect(log).not.toHaveBeenCalled();
	});

	it("warns once per outage and once when it is back", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const connection = new BullmqConnectionLog(messages);

		connection.up();
		connection.down("ping", new Error("ECONNREFUSED"));
		connection.down("enqueue", new Error("ECONNREFUSED"));
		connection.up();

		expect(warn.mock.calls).toEqual([["down: ping (ECONNREFUSED)"]]);
		expect(log.mock.calls).toEqual([["connected"], ["back"]]);
	});

	it("before the first connection, only a connection error is an outage", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const connection = new BullmqConnectionLog(messages);

		connection.down("ping", new Error("not connected yet"));
		expect(warn).not.toHaveBeenCalled();

		connection.down("connection", "ECONNREFUSED");
		expect(warn.mock.calls).toEqual([["down: connection (ECONNREFUSED)"]]);
	});
});
