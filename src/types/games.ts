export type FoundGames = {
	id: number;
	name: string;
	popularity: number;
	GamivoPrice?: number | string;
	G2APrice?: number | string;
	KinguinPrice?: number | string;
};


export interface SearchGamesRequest {
	minPopularity: number;
	gameNames: string[];
}

export interface GameAnalysisResult {
	games: FoundGames[];
	summary: {
		totalRequested: number;
		foundGames: number;
		worthyByPopularity: number;
		foundPrices: number;
		processingTimeSeconds: number;
	};
}




// Cada item do array de preços
export interface Price {
  id: number;
  originalPrice: number;
  merchant: number;
  edition: string;
  region: string;
  price: number;
  pricePaypal: number;
  feesPaypal: number;
  priceCard: number;
  feesCard: number;
  dispo: number;
  account: boolean;
  activationPlatform: string;
}

// Cada região dentro do objeto "regions"
export interface Region {
  region_short_description: string;
  filter_name: string;
  region_name: string;
  region_long_description: string;
}

// Mapeamento de regiões por chave (2, 9, steamrow, etc.)
export interface Regions {
  [key: string]: Region;
}

// Objeto principal do JSON
export interface GameData {
  prices: Price[];
  regions: Regions;
}