import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import type { ResearchGamesBody } from "@/schemas/game.schema.js";

/**
 * Corpo de `POST /api/games/research` → requisição de pesquisa da aplicação.
 *
 * É tradução de formato HTTP, por isso vive em `nest/`: renomeia os campos
 * `snake_case` do contrato. A regra de como preset e sobrescritas se combinam é do
 * Domain (`resolveSearchCriteria`),
 * não daqui. Ficam de fora o token e a entrega: decidir o que fazer com o resultado
 * é papel do controller.
 */
export const toResearchRequest = (body: ResearchGamesBody): ResearchGamesRequest => ({
	gameNames: body.gameNames,
	supplierSteamId: body.steam_id,
	listCode: body.list_code,
	title: body.title,
	criteria: resolveSearchCriteria(body.preset, {
		popularity: body.popularity,
		lookupPopularity: body.lookupPopularity,
		minPrice: body.minPrice,
		checkGamivoOffer: body.checkGamivoOffer,
	}),
});
