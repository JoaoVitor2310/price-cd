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
		// Um campo novo do pedido (o `webhook_url` do PR 2) que alguém esquecesse
		// de declarar no schema não pode sumir entre o `enqueue` e o worker.
		const withNewFields = {
			...request,
			webhookUrl: "https://chatbot.test/webhook",
			criteria: {
				...request.criteria,
				someNewCriterion: true,
				popularity: { ...request.criteria.popularity, someNewTier: 7 },
			},
		};
		const stored = JSON.parse(JSON.stringify(withNewFields));

		expect(parseResearchJobPayload(stored)).toEqual(withNewFields);
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
	])("rejects a payload with %s", (_label, payload) => {
		expect(() => parseResearchJobPayload(payload)).toThrow(
			/Invalid research job payload/,
		);
	});
});
