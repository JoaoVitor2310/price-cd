import type { SearchCriteria } from "@/domain/games/search-criteria.js";

export type FoundGames = {
	id: number;
	name: string;
	foundName?: string;
	id_steam?: string;
	popularity: number;
	region?: string;
	gamivo_id?: string;
	/** Se o AllKeyShop tem oferta da Gamivo para o jogo — o corte é do preset. */
	hasGamivoOffer?: boolean;
	GamivoPrice?: number;
	G2APrice?: number;
	KinguinPrice?: number;
};

/** O que `lists` e `suppliers` pedem ao motor: nomes + os critérios do seu preset. */
export interface SearchGamesRequest {
	gameNames: string[];
	criteria: SearchCriteria;
}
