export type FoundGames = {
	id: number;
	name: string;
	foundName?: string;
	id_steam?: string;
	popularity: number;
	region?: string;
	GamivoPrice?: number | string;
	G2APrice?: number | string;
	KinguinPrice?: number | string;
};

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
