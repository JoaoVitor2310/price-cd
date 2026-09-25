export type BumpResult = {
	code: string;
	success: boolean;
	message: string;
};

export abstract class SteamTradesBumper {
	abstract bumpUserTopics(steamId: string): Promise<BumpResult[]>;
}
