import type { FoundGames, GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";

export interface PopularityFetcher {
	fetch(gameNames: string[], minPopularity: number): Promise<FoundGames[]>;
}

export interface PriceFetcher {
	fetch(games: FoundGames[], checkGamivoOffer: boolean): Promise<FoundGames[]>;
}

export interface GameSearcher {
	search(request: SearchGamesRequest): Promise<GameAnalysisResult>;
}
