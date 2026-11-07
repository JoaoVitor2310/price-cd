import { describe, expect, it, vi } from "vitest";
import { TrackedListTopicFetcherFactory } from "@/infrastructure/lists/tracked-list-topic-fetcher-factory.js";
import { disposeIfPresent } from "@/lib/dispose.js";

const makeFetcher = () => ({
	fetchUserLists: vi.fn().mockResolvedValue([]),
	fetchList: vi.fn(),
	dispose: vi.fn().mockResolvedValue(undefined),
});

describe("TrackedListTopicFetcherFactory", () => {
	it("gives one fetcher per execution", () => {
		const newFetcher = vi.fn(makeFetcher);
		const factory = new TrackedListTopicFetcherFactory(newFetcher);

		factory.create();
		factory.create();

		expect(newFetcher).toHaveBeenCalledTimes(2);
	});

	it("delegates the reads to the fetcher", async () => {
		const fetcher = makeFetcher();
		const factory = new TrackedListTopicFetcherFactory(() => fetcher);

		await factory.create().fetchList("https://x/trade/abc");

		expect(fetcher.fetchList).toHaveBeenCalledWith("https://x/trade/abc");
	});

	it("closes on shutdown what the executions did not dispose", async () => {
		const open = makeFetcher();
		const finished = makeFetcher();
		const queue = [finished, open];
		const factory = new TrackedListTopicFetcherFactory(
			() => queue.shift() as ReturnType<typeof makeFetcher>,
		);

		await disposeIfPresent(factory.create());
		factory.create();
		await factory.onApplicationShutdown();

		expect(open.dispose).toHaveBeenCalledOnce();
		expect(finished.dispose).toHaveBeenCalledOnce();
	});

	it("refuses a new fetcher after the shutdown", async () => {
		const newFetcher = vi.fn(makeFetcher);
		const factory = new TrackedListTopicFetcherFactory(newFetcher);

		await factory.onApplicationShutdown();

		expect(() => factory.create()).toThrow(/shutting down/);
		expect(newFetcher).not.toHaveBeenCalled();
	});
});
