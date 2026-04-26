import { describe, it, expect, vi } from "vitest";
import { BumpTopicsUseCase } from "@/application/bump/bump-topics.use-case.js";
import type { SteamTradesBumper, BumpResult } from "@/application/bump/ports/steam-trades-bumper.port.js";

const STEAM_ID = "76561198000000000";

const makeBumper = (results: BumpResult[]): SteamTradesBumper => ({
	bumpUserTopics: vi.fn().mockResolvedValue(results),
});

describe("BumpTopicsUseCase", () => {
	it("classifies successful bumps correctly", async () => {
		const bumper = makeBumper([
			{ code: "AAA", success: true, message: "success" },
			{ code: "BBB", success: true, message: "success" },
		]);

		const result = await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(result.bumped).toEqual(["AAA", "BBB"]);
		expect(result.cooldown).toEqual([]);
		expect(result.failed).toEqual([]);
	});

	it("classifies cooldown responses correctly", async () => {
		const bumper = makeBumper([
			{ code: "AAA", success: false, message: "You must wait 45 minutes before bumping again." },
			{ code: "BBB", success: false, message: "Too soon to bump this topic." },
			{ code: "CCC", success: false, message: "Already bumped within the hour." },
		]);

		const result = await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(result.cooldown).toEqual(["AAA", "BBB", "CCC"]);
		expect(result.bumped).toEqual([]);
		expect(result.failed).toEqual([]);
	});

	it("classifies unexpected errors as failed", async () => {
		const bumper = makeBumper([
			{ code: "AAA", success: false, message: "Internal server error" },
			{ code: "BBB", success: false, message: "xsrf_token not found — session may have expired" },
		]);

		const result = await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(result.failed).toEqual(["AAA", "BBB"]);
		expect(result.bumped).toEqual([]);
		expect(result.cooldown).toEqual([]);
	});

	it("handles mixed results across all three categories", async () => {
		const bumper = makeBumper([
			{ code: "AAA", success: true, message: "success" },
			{ code: "BBB", success: false, message: "You must wait 1 hour." },
			{ code: "CCC", success: false, message: "Network error" },
		]);

		const result = await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(result.bumped).toEqual(["AAA"]);
		expect(result.cooldown).toEqual(["BBB"]);
		expect(result.failed).toEqual(["CCC"]);
	});

	it("returns empty arrays when bumper finds no active topics", async () => {
		const bumper = makeBumper([]);

		const result = await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(result.bumped).toEqual([]);
		expect(result.cooldown).toEqual([]);
		expect(result.failed).toEqual([]);
	});

	it("calls bumper with the provided steamId", async () => {
		const bumper = makeBumper([]);

		await new BumpTopicsUseCase().execute({ steamId: STEAM_ID, bumper });

		expect(bumper.bumpUserTopics).toHaveBeenCalledWith(STEAM_ID);
	});
});
