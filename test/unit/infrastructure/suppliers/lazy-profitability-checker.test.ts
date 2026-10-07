import { describe, expect, it, vi } from "vitest";
import type {
	ProfitabilityChecker,
	ProspectResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";
import { LazyProfitabilityChecker } from "@/infrastructure/suppliers/lazy-profitability-checker.js";

const supplier = { steam_id: "76561198000000000", list_code: "ABC12" };
const games = [{ name: "Half-Life", market_price_euro: 1.5, popularity: 100, region: null, gamivo_id: null }];

const prospect = (): ProspectResult => ({
	profitable: [],
	total_tf2_price: 0,
	offer: null,
	is_added: false,
	should_comment: false,
	last_commented_at: null,
	games_changed: false,
});

const makeInner = (result: ProspectResult = prospect()): ProfitabilityChecker => ({
	evaluate: vi.fn().mockResolvedValue(result),
});

describe("LazyProfitabilityChecker", () => {
	it("does not build the checker until the first evaluation", () => {
		const build = vi.fn(() => makeInner());

		new LazyProfitabilityChecker(build);

		expect(build).not.toHaveBeenCalled();
	});

	it("builds the checker once and reuses it", async () => {
		const build = vi.fn(() => makeInner());
		const lazy = new LazyProfitabilityChecker(build);

		await lazy.evaluate(supplier, games, "tf2");
		await lazy.evaluate(supplier, games, "eur");

		expect(build).toHaveBeenCalledTimes(1);
	});

	it("forwards the supplier, the games and the offer currency", async () => {
		const inner = makeInner();
		const lazy = new LazyProfitabilityChecker(() => inner);

		await lazy.evaluate(supplier, games, "usd");

		expect(inner.evaluate).toHaveBeenCalledWith(supplier, games, "usd");
	});

	it("returns what the built checker returned", async () => {
		const result = { ...prospect(), should_comment: true };
		const lazy = new LazyProfitabilityChecker(() => makeInner(result));

		await expect(lazy.evaluate(supplier, games, "eur")).resolves.toBe(result);
	});

	it("rejects at the first evaluation when building fails, e.g. a missing SISTEMA_ESTOQUE_URL", async () => {
		const lazy = new LazyProfitabilityChecker(() => {
			throw new Error("SISTEMA_ESTOQUE_URL is not defined");
		});

		await expect(lazy.evaluate(supplier, games, "tf2")).rejects.toThrow("SISTEMA_ESTOQUE_URL");
	});

	it("tries to build again after a failed build instead of caching the failure", async () => {
		const build = vi
			.fn<() => ProfitabilityChecker>()
			.mockImplementationOnce(() => {
				throw new Error("not configured yet");
			})
			.mockImplementation(() => makeInner());
		const lazy = new LazyProfitabilityChecker(build);

		await expect(lazy.evaluate(supplier, games, "tf2")).rejects.toThrow("not configured yet");
		await expect(lazy.evaluate(supplier, games, "tf2")).resolves.toBeDefined();
		expect(build).toHaveBeenCalledTimes(2);
	});
});
