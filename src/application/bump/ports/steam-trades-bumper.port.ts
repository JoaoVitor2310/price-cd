export type BumpResult = {
	code: string;
	success: boolean;
	message: string;
};

export interface SteamTradesBumper {
	bumpUserTopics(steamId: string): Promise<BumpResult[]>;
}
