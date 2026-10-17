import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { SEARCH_PRESETS } from "@/domain/games/search-presets.js";
import { GamesController } from "@/nest/games/games.controller.js";

const SECRET = "s3cret";

const build = () => {
	const research = { execute: vi.fn().mockResolvedValue([]) };
	const enqueue = { execute: vi.fn().mockResolvedValue(undefined) };
	const config = { get: vi.fn(() => SECRET) };
	const controller = new GamesController(
		{} as never,
		research as never,
		enqueue as never,
		{ import: vi.fn() } as never,
		config as never,
	);
	const response = { status: vi.fn() };
	return { controller, research, enqueue, response };
};

const call = async (body: Record<string, unknown>) => {
	const deps = build();
	const result = await deps.controller.research(
		{ gameNames: ["Hades"], ...body } as never,
		deps.response as never,
	);
	return { ...deps, result };
};

// Os critérios em si são testados em `research-request.mapper.test.ts`; aqui só
// interessa que o controller entrega a requisição traduzida.
describe("GamesController.research — request", () => {
	it("hands the translated request to the use case", async () => {
		const { research } = await call({ preset: "bundle-sync", steam_id: "7656" });

		expect(research.execute.mock.calls[0][0]).toMatchObject({
			supplierSteamId: "7656",
			criteria: SEARCH_PRESETS["bundle-sync"],
		});
	});
});

describe("GamesController.research — delivery", () => {
	it("without a token runs the demo, whatever delivery says", async () => {
		const { research, enqueue, result, response } = await call({ delivery: "respond" });

		expect(research.execute.mock.calls[0][0].delivery).toBe("demo");
		expect(enqueue.execute).not.toHaveBeenCalled();
		expect(response.status).toHaveBeenCalledWith(200);
		expect(result).toMatchObject({ success: true, demo: true });
	});

	it("with a token and delivery respond answers synchronously, with no demo flag", async () => {
		const { research, enqueue, result, response } = await call({
			internal_secret: SECRET,
			delivery: "respond",
		});

		expect(research.execute.mock.calls[0][0].delivery).toBe("respond");
		expect(enqueue.execute).not.toHaveBeenCalled();
		expect(response.status).toHaveBeenCalledWith(200);
		expect(result).toEqual({ success: true, games: [] });
	});

	it("with a token and no delivery queues the Trade creation", async () => {
		const { research, enqueue, result, response } = await call({ internal_secret: SECRET });

		expect(research.execute).not.toHaveBeenCalled();
		expect(enqueue.execute.mock.calls[0][0].request.criteria).toEqual(SEARCH_PRESETS.default);
		expect(response.status).toHaveBeenCalledWith(202);
		expect(result).toEqual({ success: true, status: "queued" });
	});
});
