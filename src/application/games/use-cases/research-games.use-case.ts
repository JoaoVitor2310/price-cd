import type { PriceGames } from "@/application/games/services/price-games.js";
import type {
	GameTradeImporter,
	GameTradeInput,
} from "@/application/games/ports/game-trade-importer.port.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";

const DEMO_GAME_LIMIT = 10;

/**
 * O que fazer com o resultado — decisão do chamador, independente dos critérios:
 *
 * - `trade`: cria a Trade no Sistema Estoque e não devolve nada. O caso comum.
 * - `respond`: devolve os jogos e não cria nada. Existe para a sync de bundle do
 *   Sistema Estoque, que guarda os preços no próprio bundle.
 * - `demo`: como `respond`, mas limitado a `DEMO_GAME_LIMIT` jogos — é o que roda
 *   sem token.
 *
 * Substitui o antigo `demo: boolean`, que só sabia dizer "cria Trade ou não".
 */
export type ResearchDelivery = "trade" | "respond" | "demo";

export type ResearchGamesInput = ResearchGamesRequest & {
	delivery: ResearchDelivery;
};

export class ResearchGamesUseCase {
	constructor(
		private readonly priceGames: PriceGames,
		private readonly tradeImporter: GameTradeImporter,
	) {}

	/** Devolve os jogos em `respond`/`demo`; `null` em `trade`. */
	async execute(input: ResearchGamesInput): Promise<GameTradeInput[] | null> {
		const { criteria, delivery, supplierSteamId, listCode, title } = input;

		let gameNames = [...new Set(input.gameNames)];
		// O limite é do modo demo, não do motor: as outras entregas processam a
		// lista inteira.
		if (delivery === "demo") gameNames = gameNames.slice(0, DEMO_GAME_LIMIT);

		const { priced } = await this.priceGames.run({ gameNames, criteria });

		const pricedGames: GameTradeInput[] = priced.map((g) => ({
			name: g.name,
			market_price_euro: g.GamivoPrice as number,
			popularity: g.popularity,
			region: g.region ?? null,
			id_steam: g.id_steam ?? null,
			gamivo_id: g.gamivo_id ?? null,
		}));

		if (delivery !== "trade") return pricedGames;

		if (pricedGames.length > 0) {
			await this.tradeImporter.import(pricedGames, {
				supplier_steam_id: supplierSteamId,
				list_code: listCode,
				title,
			});
		}

		return null;
	}
}
