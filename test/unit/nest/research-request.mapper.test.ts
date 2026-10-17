import { describe, expect, it } from "vitest";
import { SEARCH_PRESETS } from "@/domain/games/search-presets.js";
import { toResearchRequest } from "@/nest/games/research-request.mapper.js";
import type { ResearchGamesBody } from "@/schemas/game.schema.js";

const body = (fields: Partial<ResearchGamesBody> = {}): ResearchGamesBody => ({
	gameNames: ["Hades"],
	...fields,
});

describe("toResearchRequest", () => {
	it("renames the snake_case contract fields", () => {
		const request = toResearchRequest(
			body({ steam_id: "7656", list_code: "G0eXM", title: "Trade X" }),
		);

		expect(request).toMatchObject({
			gameNames: ["Hades"],
			supplierSteamId: "7656",
			listCode: "G0eXM",
			title: "Trade X",
		});
	});

	it("never carries the token into the application request", () => {
		expect(toResearchRequest(body({ internal_secret: "s3cret" }))).not.toHaveProperty(
			"internal_secret",
		);
	});

	it("uses the default preset when nothing is sent", () => {
		expect(toResearchRequest(body()).criteria).toEqual(SEARCH_PRESETS.default);
	});

	it("starts from the chosen preset and applies explicit fields on top", () => {
		const { criteria } = toResearchRequest(
			body({
				preset: "bundle-research",
				popularity: { aboveThreshold: 50 },
				checkGamivoOffer: true,
			}),
		);

		expect(criteria).toEqual({
			popularity: { upToThreshold: 1, aboveThreshold: 50, priceThresholdEuro: 5 },
			minPrice: 0,
			checkGamivoOffer: true,
		});
	});
});
