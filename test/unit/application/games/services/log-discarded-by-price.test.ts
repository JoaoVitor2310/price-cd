import { describe, it, expect, vi, afterEach } from "vitest";
import { logDiscardedByPrice } from "@/application/games/services/log-discarded-by-price.js";

afterEach(() => vi.restoreAllMocks());

describe("logDiscardedByPrice", () => {
	it("names the game and the price that failed the floor", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPrice([{ name: "Decay The Mare", GamivoPrice: 0.32 }]);

		expect(log).toHaveBeenCalledTimes(1);
		const [message] = log.mock.calls[0];
		expect(message).toContain("Decay The Mare");
		expect(message).toContain("€0.32");
		expect(message).toContain("€0.50");
	});

	it("reflects a custom floor in the message when one is given", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPrice([{ name: "A", GamivoPrice: 0.1 }], 1);

		expect(log.mock.calls[0][0]).toContain("€1.00");
		expect(log.mock.calls[0][0]).not.toContain("€0.50");
	});

	it("says so explicitly when the game has no price at all", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPrice([{ name: "Ghost Game" }]);

		expect(log.mock.calls[0][0]).toContain("no price");
		expect(log.mock.calls[0][0]).not.toContain("undefined");
	});

	it("logs one line per discarded game", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPrice([
			{ name: "A", GamivoPrice: 0.1 },
			{ name: "B", GamivoPrice: 0.5 },
		]);

		expect(log).toHaveBeenCalledTimes(2);
	});

	it("stays quiet when nothing was discarded", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		logDiscardedByPrice([]);

		expect(log).not.toHaveBeenCalled();
	});
});
