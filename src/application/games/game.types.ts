export type FoundGames = {
	id: number;
	name: string;
	foundName?: string;
	id_steam?: string;
	popularity: number;
	region?: string;
	gamivo_id?: string;
	GamivoPrice?: number;
	G2APrice?: number;
	KinguinPrice?: number;
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
