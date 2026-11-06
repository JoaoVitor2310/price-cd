import { describe, expect, it } from "vitest";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { parseResearchJobPayload } from "@/infrastructure/background/research-job-payload.js";

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
