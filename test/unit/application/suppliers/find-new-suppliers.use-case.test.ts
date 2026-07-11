import { describe, it, expect, vi, beforeEach } from "vitest";
import { FindNewSuppliersUseCase } from "@/application/suppliers/find-new-suppliers.use-case.js";
import type { FindNewSuppliersInput } from "@/application/suppliers/find-new-suppliers.use-case.js";
import type { TopicData } from "@/application/suppliers/ports/topic-scraper.port.js";
import type { ProspectResult } from "@/application/suppliers/ports/profitability-checker.port.js";
import type { GameAnalysisResult } from "@/application/games/game.types.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeTopic(overrides: Partial<TopicData> = {}): TopicData {
    return {
        authorName: "Trader",
        steamId: "76561198888888888",
        games: ["Half-Life"],
        isInactive: false,
        ...overrides,
    };
}

function makeProspectResult(overrides: Partial<ProspectResult> = {}): ProspectResult {
    return {
        profitable: [{ name: "Half-Life", price_euro: 1.5, popularity: 100, region: null, tf2_price: 0.5 }],
        is_added: false,
        should_comment: true,
        last_commented_at: null,
        games_changed: false,
        ...overrides,
    };
}

function makeGameResult(): GameAnalysisResult {
    return {
        games: [{ id: 0, name: "Half-Life", popularity: 100, GamivoPrice: 1.5 }],
        summary: { totalRequested: 1, foundGames: 1, worthyByPopularity: 1, foundPrices: 1, processingTimeSeconds: 0 },
    };
}

function makeInput(overrides: Partial<FindNewSuppliersInput> = {}): FindNewSuppliersInput {
    const paginator = {
        getTopicsFromPage: vi.fn()
            .mockResolvedValueOnce([{ code: "ABC", url: "https://steamtrades.com/trade/ABC" }])
            .mockResolvedValue([]),
    };
    const scraper = { scrape: vi.fn().mockResolvedValue(makeTopic()) };
    const commentPoster = { post: vi.fn().mockResolvedValue(undefined) };
    const profitabilityChecker = { evaluate: vi.fn().mockResolvedValue(makeProspectResult()) };
    const gameSearcher = { search: vi.fn().mockResolvedValue(makeGameResult()) };

    return { paginator, scraper, commentPoster, profitabilityChecker, gameSearcher, ignoredSteamId: null, ...overrides };
}

// ---------------------------------------------------------------------------

describe("FindNewSuppliersUseCase", () => {
    let useCase: FindNewSuppliersUseCase;

    beforeEach(() => {
        useCase = new FindNewSuppliersUseCase();
    });

    // --- should_comment ---

    it("comments when should_comment is true", async () => {
        const input = makeInput({
            profitabilityChecker: { evaluate: vi.fn().mockResolvedValue(makeProspectResult({ should_comment: true })) },
        });

        const result = await useCase.execute(input);

        expect(input.commentPoster.post).toHaveBeenCalledTimes(1);
        expect(result.suppliersCommented).toBe(1);
    });

    it("does not comment when should_comment is false", async () => {
        const input = makeInput({
            profitabilityChecker: { evaluate: vi.fn().mockResolvedValue(makeProspectResult({ should_comment: false })) },
        });

        const result = await useCase.execute(input);

        expect(input.commentPoster.post).not.toHaveBeenCalled();
        expect(result.suppliersCommented).toBe(0);
    });

    it("passes list_code from the topic code to evaluate", async () => {
        const input = makeInput();

        await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).toHaveBeenCalledWith(
            expect.objectContaining({ list_code: "ABC" }),
            expect.any(Array),
        );
    });

    // --- ignoredSteamId ---

    it("skips a topic whose steamId matches ignoredSteamId", async () => {
        const ignoredId = "76561199999999999";
        const input = makeInput({
            ignoredSteamId: ignoredId,
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ steamId: ignoredId })) },
        });

        const result = await useCase.execute(input);

        expect(input.commentPoster.post).not.toHaveBeenCalled();
        expect(input.profitabilityChecker.evaluate).not.toHaveBeenCalled();
        expect(result.suppliersCommented).toBe(0);
    });

    it("does not skip a topic when ignoredSteamId is null", async () => {
        const input = makeInput({ ignoredSteamId: null });

        await useCase.execute(input);

        expect(input.commentPoster.post).toHaveBeenCalledTimes(1);
    });

    it("does not skip a topic with a different steamId", async () => {
        const input = makeInput({
            ignoredSteamId: "76561199999999999",
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ steamId: "76561198888888888" })) },
        });

        await useCase.execute(input);

        expect(input.commentPoster.post).toHaveBeenCalledTimes(1);
    });

    // --- early exits ---

    it("skips inactive topics without calling profitabilityChecker", async () => {
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ isInactive: true })) },
        });

        const result = await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).not.toHaveBeenCalled();
        expect(result.suppliersCommented).toBe(0);
    });

    it("skips topics with no steamId", async () => {
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ steamId: "" })) },
        });

        await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).not.toHaveBeenCalled();
    });

    it("skips topics with no games in .have section", async () => {
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ games: [] })) },
        });

        await useCase.execute(input);

        expect(input.gameSearcher.search).not.toHaveBeenCalled();
    });

    it("skips topics where no priced games were found", async () => {
        const input = makeInput({
            gameSearcher: { search: vi.fn().mockResolvedValue({ games: [], summary: { totalRequested: 1, foundGames: 0, worthyByPopularity: 0, foundPrices: 0, processingTimeSeconds: 0 } }) },
        });

        await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).not.toHaveBeenCalled();
        expect(input.commentPoster.post).not.toHaveBeenCalled();
    });

    // --- game cap ---

    it("passes at most 50 games to gameSearcher even when the topic has more", async () => {
        const manyGames = Array.from({ length: 120 }, (_, i) => `Game ${i + 1}`);
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ games: manyGames })) },
        });

        await useCase.execute(input);

        const calledWith = input.gameSearcher.search.mock.calls[0][0].gameNames;
        expect(calledWith).toHaveLength(50);
        expect(calledWith[0]).toBe("Game 1");
        expect(calledWith[49]).toBe("Game 50");
    });

    it("passes all games when the topic has 50 or fewer", async () => {
        const games = Array.from({ length: 30 }, (_, i) => `Game ${i + 1}`);
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ games })) },
        });

        await useCase.execute(input);

        const calledWith = input.gameSearcher.search.mock.calls[0][0].gameNames;
        expect(calledWith).toHaveLength(30);
    });

    // --- pagination ---

    it("stops pagination after MAX_CONSECUTIVE_INACTIVE inactive topics", async () => {
        const input = makeInput({
            paginator: {
                getTopicsFromPage: vi.fn().mockResolvedValue([
                    { code: "T1", url: "https://steamtrades.com/trade/T1" },
                    { code: "T2", url: "https://steamtrades.com/trade/T2" },
                    { code: "T3", url: "https://steamtrades.com/trade/T3" },
                    { code: "T4", url: "https://steamtrades.com/trade/T4" },
                    { code: "T5", url: "https://steamtrades.com/trade/T5" },
                ]),
            },
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ isInactive: true })) },
        });

        const result = await useCase.execute(input);

        expect(result.pagesVisited).toBe(1);
        expect(input.commentPoster.post).not.toHaveBeenCalled();
    });
});
