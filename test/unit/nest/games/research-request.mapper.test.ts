import { describe, expect, it } from "vitest";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { toTopicResearchRequest } from "@/nest/games/research-request.mapper.js";
import { researchFromTopicBodySchema } from "@/schemas/game.schema.js";

describe("toTopicResearchRequest", () => {
	it("uses the topic code as the list code and the lists preset", () => {
		const body = researchFromTopicBodySchema.parse({
			topic_url: "https://www.steamtrades.com/trade/wGVYD/slug?page=2",
			steam_id: "76561198012345678",
			currency: "tf2",
			request_uuid: "8c1f0000-0000-4000-8000-000000000000",
			webhook_url: "http://chatbot:3000/webhooks/price-cd",
			internal_secret: "token",
		});

		expect(toTopicResearchRequest(body)).toEqual({
			topicUrl: "https://www.steamtrades.com/trade/wGVYD/slug",
			listCode: "wGVYD",
			supplierSteamId: "76561198012345678",
			currency: "tf2",
			requestUuid: "8c1f0000-0000-4000-8000-000000000000",
			webhookUrl: "http://chatbot:3000/webhooks/price-cd",
			criteria: resolveSearchCriteria("lists", {}),
		});
	});
});
