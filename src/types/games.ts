export type FoundGames = {
  id: number;
  name: string;
  foundName?: string;
  id_steam?: string;
  popularity: number;
  GamivoPrice?: number | string;
  G2APrice?: number | string;
  KinguinPrice?: number | string;
};

export interface SearchGamesIdSteamRequest {
  games: {
    id: number;
    name: string;
  }[];
}

export interface SearchGamesIdSteamResponse {
  games: {
    id: number;
    name: string;
    id_steam?: string;
  }[];
}

export interface SearchGamesRequest {
  minPopularity: number;
  gameNames: string[];
  checkGamivoOffer: boolean;
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

export interface Merchant {
  name: string;
  logo: string;
  rating: {
    score: number;
    count: number;
    maximum: number;
  };
  official: boolean;
  paypal: boolean;
}

export interface Merchants {
  [key: string]: Merchant;
}

export interface GameData {
  prices: Price[];
  regions: Regions;
  merchants: Merchants;
}