export type TopicData = {
    authorName: string;
    steamId: string;
    games: string[];
    isInactive: boolean;
    hasRecentComment: boolean;
};

export interface TopicScraper {
    scrape(url: string): Promise<TopicData>;
}
