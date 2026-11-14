import { describe, expect, it } from "vitest";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import {
	parseResearchJobPayload,
	readResearchFailureTarget,
} from "@/infrastructure/background/research-job-payload.js";

const request: ResearchGamesRequest = {
	gameNames: ["Half-Life", "Portal 2"],
	criteria: resolveSearchCriteria("default", { checkGamivoOffer: true }),
	supplierSteamId: "76561198888888888",
	listCode: "G0eXM",
	title: "Trade from supplier X",
};

describe("parseResearchJobPayload", () => {
	it("accepts what enqueue stores, after a JSON round trip", () => {
		// É o que o Redis devolve: o pedido passou por JSON.
		const stored = JSON.parse(JSON.stringify(request));

		expect(parseResearchJobPayload(stored)).toEqual(request);
	});

	it("keeps fields the schema does not declare, at every level", () => {
		// Um campo novo do pedido que alguém esquecesse de declarar no schema não
		// pode sumir entre o `enqueue` e o worker.
		const withNewFields = {
			...request,
			someFutureField: "kept",
			criteria: {
				...request.criteria,
				someNewCriterion: true,
				popularity: { ...request.criteria.popularity, someNewTier: 7 },
			},
		};
		const stored = JSON.parse(JSON.stringify(withNewFields));

		expect(parseResearchJobPayload(stored)).toEqual(withNewFields);
	});

	it("accepts a research from a topic, which has no gameNames", () => {
		const { gameNames: _gameNames, ...rest } = request;
		const fromTopic = {
			...rest,
			topicUrl: "https://www.steamtrades.com/trade/wGVYD/slug",
		};

		expect(
			parseResearchJobPayload(JSON.parse(JSON.stringify(fromTopic))),
		).toEqual(fromTopic);
	});

	it("refuses a job with neither gameNames nor topicUrl", () => {
		const { gameNames: _gameNames, ...rest } = request;

		expect(() => parseResearchJobPayload(rest)).toThrow(
			/Invalid research job payload/,
		);
	});

	it("keeps the result-notification fields", () => {
		const withWebhook: ResearchGamesRequest = {
			...request,
			currency: "eur",
			requestUuid: "8c1f0000-0000-4000-8000-000000000000",
			webhookUrl: "http://chatbot:3000/webhooks/price-cd",
		};

		expect(
			parseResearchJobPayload(JSON.parse(JSON.stringify(withWebhook))),
		).toEqual(withWebhook);
	});

	it("accepts a request without the optional Trade fields", () => {
		const minimal = { gameNames: ["Hades"], criteria: request.criteria };

		expect(parseResearchJobPayload(minimal)).toEqual(minimal);
	});

	it.each([
		["no game names", { ...request, gameNames: [] }],
		["no criteria", { gameNames: ["Hades"] }],
		[
			"a criterion of the wrong type",
			{ ...request, criteria: { ...request.criteria, minPrice: "0.5" } },
		],
		["an unknown currency", { ...request, currency: "brl" }],
	])("rejects a payload with %s", (_label, payload) => {
		expect(() => parseResearchJobPayload(payload)).toThrow(
			/Invalid research job payload/,
		);
	});
});

describe("the progress saved next to the request", () => {
	it("never reaches the use case as part of the request", () => {
		const stored = JSON.parse(
			JSON.stringify({
				...request,
				checkpoint: { outcome: { status: "created", tradeUuid: "3a9e" } },
			}),
		);

		expect(parseResearchJobPayload(stored)).toEqual(request);
	});
});

describe("readResearchFailureTarget", () => {
	const target = {
		webhookUrl: "http://chatbot:3000/webhooks/price-cd",
		requestUuid: "8c1f0000-0000-4000-8000-000000000000",
	};

	it("reads the target of a payload the job parser refuses", () => {
		const unreadable = { ...target, gameNames: "not a list" };

		expect(() => parseResearchJobPayload(unreadable)).toThrow();
		expect(readResearchFailureTarget(unreadable)).toEqual(target);
	});

	it("keeps the webhook when only the request uuid cannot be read", () => {
		const data = { webhookUrl: target.webhookUrl, requestUuid: 7 };

		expect(readResearchFailureTarget(data)).toEqual({
			webhookUrl: target.webhookUrl,
			requestUuid: undefined,
		});
		// O `jobId` é o `requestUuid` que o `enqueue` usou.
		expect(readResearchFailureTarget(data, target.requestUuid)).toEqual(target);
	});

	it("prefers the stored request uuid to the job id", () => {
		expect(readResearchFailureTarget(target, "another-id")).toEqual(target);
	});

	it("returns only the target, not the rest of the request", () => {
		expect(readResearchFailureTarget({ ...request, ...target })).toEqual(
			target,
		);
	});

	it.each([
		["no webhook", { gameNames: ["Hades"] }],
		["a target of the wrong type", { webhookUrl: 7 }],
		["something that is not an object", "garbage"],
	])("finds nobody to report to with %s", (_label, data) => {
		const found = readResearchFailureTarget(data);

		expect(found.webhookUrl).toBeUndefined();
	});
});
