import type { PriceGames } from "@/application/games/services/price-games.js";
import type {
	GameTradeImporter,
	GameTradeInput,
} from "@/application/games/ports/game-trade-importer.port.js";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";
import { filterExcludedGames } from "@/domain/games/excluded-games.js";
import { partitionByPrice } from "@/domain/games/worthy-by-price.js";
import { logDiscardedByPrice } from "@/application/games/services/log-discarded-by-price.js";

const DEMO_GAME_LIMIT = 10;

export type ResearchGamesInput = {
	gameNames: string[];
	minPopularity: number;
	checkGamivoOffer: boolean;
	/** Piso de preço negociável. Omitido → default do domínio (`MIN_PRICE_EURO`). */
	minPrice?: number;
	supplierSteamId?: string;
	listCode?: string;
	title?: string;
	/**
	 * Modo demonstração: limita a lista, devolve os jogos precificados e **não**
	 * cria Trade no Sistema Estoque.
	 *
	 * É dado de entrada, não ausência de dependência. Antes o modo era inferido
	 * de `tradeImporter === undefined`, o que fazia a dependência valer como
	 * flag: quem esquecesse de passar o importer criava um modo demo silencioso
	 * em vez de um erro. Agora o chamador declara a intenção.
	 */
	demo: boolean;
};

export class ResearchGamesUseCase {
	constructor(
		private readonly priceGames: PriceGames,
		private readonly tradeImporter: GameTradeImporter,
	) {}

	// Returns null when results were sent to inventory (authenticated).
	// Returns the priced games list when in demo mode.
	async execute(input: ResearchGamesInput): Promise<GameTradeInput[] | null> {
		const { minPopularity, checkGamivoOffer, minPrice, supplierSteamId, listCode, title } =
			input;

		const isDemo = input.demo;
		let gameNames = [...new Set(input.gameNames)];
		// O limite é do modo demo, não do motor: a pesquisa autenticada processa
		// a lista inteira.
		if (isDemo) gameNames = gameNames.slice(0, DEMO_GAME_LIMIT);

		const { worthyByPopularity: worthyGames, priced: worthy } =
			await this.priceGames.run({
				gameNames,
				minPopularity,
				checkGamivoOffer,
				minPrice,
			});

		if (worthyGames.length === 0) return isDemo ? [] : null;

		const pricedGames: GameTradeInput[] = worthy
			.map((g) => ({
				name: g.name,
				price_euro: g.GamivoPrice as number,
				popularity: g.popularity,
				region: g.region ?? null,
				id_steam: g.id_steam ?? null,
				gamivo_id: g.gamivo_id ?? null,
			}));

		if (isDemo) return pricedGames;

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
