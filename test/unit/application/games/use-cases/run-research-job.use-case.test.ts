import { describe, expect, it, vi } from "vitest";
import type {
	ResearchGamesRequest,
	TopicResearchRequest,
} from "@/application/games/ports/research-games-runner.port.js";
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
	type ReadTopicGames,
	TopicScrapeFailedError,
} from "@/application/games/services/read-topic-games.js";
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

const TOPIC_URL = "https://www.steamtrades.com/trade/wGVYD/slug";

const topicRequest = (): TopicResearchRequest => {
	const { gameNames: _gameNames, ...rest } = request();
	return { ...rest, topicUrl: TOPIC_URL, listCode: "wGVYD" };
};

function setup(
	run: () => Promise<ResearchTradeOutcome>,
	readTopic: () => Promise<string[]> = async () => [],
) {
	const createTrade = { run: vi.fn(run) };
	const readTopicGames = { run: vi.fn(readTopic) };
	const notifier = {
		notify: vi.fn().mockResolvedValue(undefined),
	} satisfies ResearchResultNotifier;
	const useCase = new RunResearchJobUseCase(
		createTrade as unknown as CreateResearchTrade,
		notifier,
		readTopicGames as unknown as ReadTopicGames,
	);
	return { useCase, createTrade, notifier, readTopicGames };
}

const target = { webhookUrl: WEBHOOK_URL, requestUuid: REQUEST_UUID };

describe("RunResearchJobUseCase — research from a topic", () => {
	const created = async (): Promise<ResearchTradeOutcome> => ({
		status: "created",
		tradeUuid: TRADE_UUID,
	});

	it("researches the topic's games, with the topic code as the list code", async () => {
		const { useCase, createTrade, notifier, readTopicGames } = setup(
			created,
			async () => ["Hades", "Celeste"],
		);

		await useCase.run(topicRequest());

		expect(readTopicGames.run).toHaveBeenCalledWith(TOPIC_URL);
		const { topicUrl: _topicUrl, ...rest } = topicRequest();
		expect(createTrade.run).toHaveBeenCalledWith(
			{ ...rest, gameNames: ["Hades", "Celeste"] },
			undefined,
		);
		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "trade_created",
			tradeUuid: TRADE_UUID,
		});
	});

	it("does not read any topic for a request with gameNames", async () => {
		const { useCase, readTopicGames } = setup(created);

		await useCase.run(request());

		expect(readTopicGames.run).not.toHaveBeenCalled();
	});

	it("reports no_trade without researching when the topic has no games", async () => {
		const { useCase, createTrade, notifier } = setup(created, async () => []);

		await useCase.run(topicRequest());

		expect(createTrade.run).not.toHaveBeenCalled();
		expect(notifier.notify).toHaveBeenCalledWith(target, { result: "no_trade" });
	});

	it("reports scrape_failed and propagates the error for the job record", async () => {
		const error = new TopicScrapeFailedError(TOPIC_URL);
		const { useCase, createTrade, notifier } = setup(created, async () => {
			throw error;
		});

		await expect(useCase.run(topicRequest())).rejects.toBe(error);

		expect(createTrade.run).not.toHaveBeenCalled();
		expect(notifier.notify).toHaveBeenCalledWith(target, {
			result: "failed",
			failure: {
				kind: "scrape_failed",
				message: FAILURE_MESSAGES.scrape_failed,
			},
		});
	});

	it("does not report a scrape failure caused by the shutdown", async () => {
		const { useCase, notifier } = setup(created, async () => {
			throw new TopicScrapeFailedError(TOPIC_URL);
		});

		await expect(
			useCase.run(topicRequest(), { aborted: true }),
		).rejects.toBeInstanceOf(TopicScrapeFailedError);

		expect(notifier.notify).not.toHaveBeenCalled();
	});

	it("stops before researching when the shutdown came during the scrape", async () => {
		const signal = { aborted: false };
		const { useCase, createTrade, notifier } = setup(created, async () => {
			signal.aborted = true;
			return ["Hades"];
		});

		await expect(useCase.run(topicRequest(), signal)).rejects.toBeInstanceOf(
			ResearchCancelledError,
		);

		expect(createTrade.run).not.toHaveBeenCalled();
		expect(notifier.notify).not.toHaveBeenCalled();
	});
});

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
