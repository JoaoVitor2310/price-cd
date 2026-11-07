import type {
	ResearchGamesRequest,
	TopicResearchRequest,
} from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import type {
	ResearchFromTopicBody,
	ResearchGamesBody,
} from "@/schemas/game.schema.js";

/**
 * Corpo de `POST /api/games/research` → requisição de pesquisa da aplicação.
 *
 * É tradução de formato HTTP, por isso vive em `nest/`: renomeia os campos
 * `snake_case` do contrato. A regra de como preset e sobrescritas se combinam é do
 * Domain (`resolveSearchCriteria`),
 * não daqui. Ficam de fora o token e a entrega: decidir o que fazer com o resultado
 * é papel do controller.
 */
export const toResearchRequest = (
	body: ResearchGamesBody,
): ResearchGamesRequest => ({
	gameNames: body.gameNames,
	supplierSteamId: body.steam_id,
	listCode: body.list_code,
	title: body.title,
	currency: body.currency,
	requestUuid: body.request_uuid,
	webhookUrl: body.webhook_url,
	criteria: resolveSearchCriteria(body.preset, {
		popularity: body.popularity,
		lookupPopularity: body.lookupPopularity,
		minPrice: body.minPrice,
		checkGamivoOffer: body.checkGamivoOffer,
	}),
});

/**
 * Corpo de `POST /api/games/research/from-topic` → pedido da aplicação. O código
 * do tópico vira o `listCode` da Trade, e os critérios são os do preset `lists`,
 * o mesmo pipeline do Reabastecimento.
 */
export const toTopicResearchRequest = (
	body: ResearchFromTopicBody,
): TopicResearchRequest => ({
	topicUrl: body.topic_url.url,
	listCode: body.topic_url.code,
	supplierSteamId: body.steam_id,
	currency: body.currency,
	requestUuid: body.request_uuid,
	webhookUrl: body.webhook_url,
	criteria: resolveSearchCriteria("lists", {}),
});
