import type { FoundGames, GameAnalysisResult } from "@/types/games.js";
import type { SearchGamesRequest } from "@/types/games.js";

export interface PopularityFetcher {
	fetch(gameNames: string[], minPopularity: number): Promise<FoundGames[]>;
}

export interface PriceFetcher {
	fetch(games: FoundGames[], checkGamivoOffer: boolean): Promise<FoundGames[]>;
}

export interface GameSearcher {
	search(request: SearchGamesRequest): Promise<GameAnalysisResult>;
}
