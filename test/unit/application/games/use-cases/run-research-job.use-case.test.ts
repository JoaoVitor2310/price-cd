import { describe, expect, it, vi } from "vitest";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { ResearchResultNotifier } from "@/application/games/ports/research-result-notifier.port.js";
import {
	StockUnavailableError,
	TradeOutcomeUnknownError,
	TradeRejectedError,
} from "@/application/games/ports/trade-with-offer-creator.port.js";
import {
	type CreateResearchTrade,
	PriceResearchIncompleteError,
	ResearchCancelledError,
	type ResearchTradeOutcome,
} from "@/application/games/services/create-research-trade.js";
import {
	FAILURE_MESSAGES,
	RunResearchJobUseCase,
} from "@/application/games/use-cases/run-research-job.use-case.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";

const REQUEST_UUID = "8c1f0000-0000-4000-8000-000000000000";
const TRADE_UUID = "3a9e0000-0000-4000-8000-000000000000";
const WEBHOOK_URL = "http://chatbot:3000/webhooks/price-cd";

const request = (
	overrides: Partial<ResearchGamesRequest> = {},
): ResearchGamesRequest => ({
	gameNames: ["Half-Life", "Rust ROW"],
	criteria: resolveSearchCriteria("default", {}),
	supplierSteamId: "76561198012345678",
	currency: "eur",
	requestUuid: REQUEST_UUID,
	webhookUrl: WEBHOOK_URL,
	...overrides,
});

function setup(run: () => Promise<ResearchTradeOutcome>) {
	const createTrade = { run: vi.fn(run) };
	const notifier = {
		notify: vi.fn().mockResolvedValue(undefined),
	} satisfies ResearchResultNotifier;
	const useCase = new RunResearchJobUseCase(
		createTrade as unknown as CreateResearchTrade,
		notifier,
	);
	return { useCase, createTrade, notifier };
}

const target = { webhookUrl: WEBHOOK_URL, requestUuid: REQUEST_UUID };

describe("RunResearchJobUseCase", () => {
	it("reports trade_created with the Trade uuid, after the Sistema Estoque answered", async () => {
		const { useCase, createTrade, notifier } = setup(async () => ({
			status: "created",
			tradeUuid: TRADE_UUID,
		}));

		await useCase.run(request());

		expect(createTrade.run).toHaveBeenCalledWith(request(), undefined);
		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "trade_created",
			tradeUuid: TRADE_UUID,
		});
		// A ordem é o contrato: o aviso só sai com a Trade já criada.
		expect(createTrade.run.mock.invocationCallOrder[0]).toBeLessThan(
			notifier.notify.mock.invocationCallOrder[0],
		);
	});

	it.each(["nothing_priced", "nothing_to_offer"] as const)(
		"reports no_trade when %s",
		async (reason) => {
			const { useCase, notifier } = setup(async () => ({
				status: "not_created",
				reason,
			}));

			await useCase.run(request());

			expect(notifier.notify).toHaveBeenCalledWith(target, {
				result: "no_trade",
			});
		},
	);

	it("reports stock_unavailable for a Sistema Estoque that could not answer, and still fails the job", async () => {
		const error = new StockUnavailableError(
			"Sistema Estoque answered HTTP 503",
		);
		const { useCase, notifier } = setup(() => Promise.reject(error));

		await expect(useCase.run(request())).rejects.toBe(error);

		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "failed",
			failure: {
				kind: "stock_unavailable",
				message: FAILURE_MESSAGES.stock_unavailable,
			},
		});
	});

	it.each([
		[
			"a rejected Trade",
			new TradeRejectedError("Sistema Estoque rejected the Trade (422)"),
		],
		["a pricing failure", new Error("Cloudflare challenge did not clear")],
	])("reports pricing_failed for %s", async (_label, error) => {
		const { useCase, notifier } = setup(() => Promise.reject(error));

		await expect(useCase.run(request())).rejects.toBe(error);

		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "failed",
			// A mensagem é fixa: o texto do erro interno não sai do price-cd.
			failure: {
				kind: "pricing_failed",
				message: FAILURE_MESSAGES.pricing_failed,
			},
		});
	});

	it.each([
		["every lookup failed", new PriceResearchIncompleteError(3)],
		["the Trade uuid is unreadable", new TradeOutcomeUnknownError("bad 201")],
	])("reports pricing_failed when %s, not an invitation to retry", async (_, error) => {
		const { useCase, notifier } = setup(() => Promise.reject(error));

		await expect(useCase.run(request())).rejects.toBe(error);

		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "failed",
			failure: {
				kind: "pricing_failed",
				message: FAILURE_MESSAGES.pricing_failed,
			},
		});
	});

	it("hands the signal to the use case, which stops before the Sistema Estoque", async () => {
		const error = new ResearchCancelledError();
		const { useCase, createTrade, notifier } = setup(() =>
			Promise.reject(error),
		);
		const signal = { aborted: true };

		await expect(useCase.run(request(), signal)).rejects.toBe(error);

		expect(createTrade.run).toHaveBeenCalledWith(request(), signal);
		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("does not report a failure caused by the shutdown: the request runs again", async () => {
		const error = new Error("Target closed");
		const { useCase, notifier } = setup(() => Promise.reject(error));

		await expect(useCase.run(request(), { aborted: true })).rejects.toBe(error);

		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("notifies nobody when the request has no webhook", async () => {
		const { useCase, notifier } = setup(async () => ({ status: "created" }));

		await useCase.run(request({ webhookUrl: undefined, currency: undefined }));

		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("still fails the job when there is no webhook to report the failure to", async () => {
		const { useCase, notifier } = setup(() =>
			Promise.reject(new Error("boom")),
		);

		await expect(
			useCase.run(request({ webhookUrl: undefined })),
		).rejects.toThrow("boom");
		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("reports a failure instead of a trade_created without a uuid", async () => {
		const { useCase, notifier } = setup(async () => ({ status: "created" }));

		await useCase.run(request());

		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "failed",
			failure: {
				kind: "pricing_failed",
				message: FAILURE_MESSAGES.pricing_failed,
			},
		});
	});

	it("fails the job when the result cannot be stored for delivery", async () => {
		const { useCase, notifier } = setup(async () => ({
			status: "created",
			tradeUuid: TRADE_UUID,
		}));
		notifier.notify.mockRejectedValue(new Error("Webhook queue unavailable"));

		await expect(useCase.run(request())).rejects.toThrow(
			"Webhook queue unavailable",
		);
	});

	it("keeps the original error when the failed result cannot be stored either", async () => {
		const error = new StockUnavailableError(
			"Sistema Estoque answered HTTP 503",
		);
		const { useCase, notifier } = setup(() => Promise.reject(error));
		notifier.notify.mockRejectedValue(new Error("Webhook queue unavailable"));
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});

		// É o erro original que o job registra, não o do aviso.
		await expect(useCase.run(request())).rejects.toBe(error);
		expect(logged).toHaveBeenCalled();
		logged.mockRestore();
	});

	it("never sends the internal error text to whoever asked", async () => {
		const { useCase, notifier } = setup(() =>
			Promise.reject(
				new Error("Cloudflare blocked https://www.allkeyshop.com (ray 8f2)"),
			),
		);

		await expect(useCase.run(request())).rejects.toThrow();

		const [, result] = notifier.notify.mock.calls[0];
		expect(JSON.stringify(result)).not.toContain("allkeyshop");
	});
});
