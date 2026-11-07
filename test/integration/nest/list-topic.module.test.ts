import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";

const { fetcher } = vi.hoisted(() => ({
	fetcher: {
		fetchUserLists: vi.fn(),
		fetchList: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
	},
}));

vi.mock("@/infrastructure/lists/fetch-list-topic.js", () => ({
	fetchListTopic: () => fetcher,
}));

import { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import { ListTopicModule } from "@/nest/lists/list-topic.module.js";

describe("ListTopicModule", () => {
	it("closes the open fetchers when the application shuts down", async () => {
		const moduleRef = await Test.createTestingModule({
			imports: [ListTopicModule],
		}).compile();
		const app = moduleRef.createNestApplication();
		await app.init();

		app.get(ListTopicFetcherFactory).create();
		await app.close();

		expect(fetcher.dispose).toHaveBeenCalledOnce();
	});
});
