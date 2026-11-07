import { describe, expect, it, vi } from "vitest";
import {
	ReadTopicGames,
	TopicScrapeFailedError,
} from "@/application/games/services/read-topic-games.js";
import { ListTopic, type ListTopicStatus } from "@/domain/lists/list-topic.js";

const TOPIC_URL = "https://www.steamtrades.com/trade/wGVYD/slug";

const makeFetcher = (fetchList: () => Promise<ListTopic>) => ({
	fetchUserLists: vi.fn(),
	fetchList: vi.fn(fetchList),
	dispose: vi.fn().mockResolvedValue(undefined),
});

const topic = (status: ListTopicStatus, gameNames: string[] = []) =>
	new ListTopic(TOPIC_URL, status, gameNames);

describe("ReadTopicGames", () => {
	it("returns every game of an active topic and closes the browser", async () => {
		const games = Array.from({ length: 300 }, (_, i) => `Game ${i}`);
		const fetcher = makeFetcher(async () => topic("active", games));

		const result = await new ReadTopicGames({ create: () => fetcher }).run(
			TOPIC_URL,
		);

		expect(result).toEqual(games);
		expect(fetcher.fetchList).toHaveBeenCalledWith(TOPIC_URL);
		expect(fetcher.dispose).toHaveBeenCalledOnce();
	});

	it("researches an inactive topic too: the supplier sent the link", async () => {
		const fetcher = makeFetcher(async () => topic("inactive", ["Hades"]));

		await expect(
			new ReadTopicGames({ create: () => fetcher }).run(TOPIC_URL),
		).resolves.toEqual(["Hades"]);
	});

	it("refuses a link outside SteamTrades without opening a browser", async () => {
		const create = vi.fn();

		await expect(
			new ReadTopicGames({ create }).run("http://redis:6379/"),
		).rejects.toBeInstanceOf(TopicScrapeFailedError);

		expect(create).not.toHaveBeenCalled();
	});

	it("fails when the topic could not be read", async () => {
		const fetcher = makeFetcher(async () => topic("unreadable"));

		await expect(
			new ReadTopicGames({ create: () => fetcher }).run(TOPIC_URL),
		).rejects.toBeInstanceOf(TopicScrapeFailedError);
		expect(fetcher.dispose).toHaveBeenCalledOnce();
	});

	it("wraps a scraping error, keeps it as the cause and still closes the browser", async () => {
		const cause = new Error("Cloudflare blocked");
		const fetcher = makeFetcher(async () => {
			throw cause;
		});

		const error = await new ReadTopicGames({ create: () => fetcher })
			.run(TOPIC_URL)
			.catch((caught) => caught);

		expect(error).toBeInstanceOf(TopicScrapeFailedError);
		expect(error.cause).toBe(cause);
		expect(error.message).toContain("Cloudflare blocked");
		expect(fetcher.dispose).toHaveBeenCalledOnce();
	});
});
