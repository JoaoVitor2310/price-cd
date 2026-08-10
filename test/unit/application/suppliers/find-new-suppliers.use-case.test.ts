import { describe, it, expect, vi, beforeEach } from "vitest";
import { FindNewSuppliersUseCase } from "@/application/suppliers/find-new-suppliers.use-case.js";
import type { FindNewSuppliersInput } from "@/application/suppliers/find-new-suppliers.use-case.js";
import type { TopicData } from "@/application/suppliers/ports/topic-scraper.port.js";
import type { ProspectResult } from "@/application/suppliers/ports/profitability-checker.port.js";
import type { GameAnalysisResult } from "@/application/games/game.types.js";
import { TF2_SEARCH_TERMS } from "@/domain/suppliers/tf2-key-matching.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeTopic(overrides: Partial<TopicData> = {}): TopicData {
    return {
        authorName: "Trader",
        steamId: "76561198888888888",
        games: ["Half-Life"],
        isInactive: false,
        wantsTf2Key: true,
        ...overrides,
    };
}

function makeProspectResult(overrides: Partial<ProspectResult> = {}): ProspectResult {
    return {
        profitable: [{ name: "Half-Life", price_euro: 1.5, popularity: 100, region: null, tf2_price: 0.5 }],
        total_tf2_price: 0.5,
        is_added: false,
        should_comment: true,
        last_commented_at: null,
        games_changed: false,
        ...overrides,
    };
}

function makeGameResult(gameOverrides: Partial<GameAnalysisResult["games"][number]> = {}): GameAnalysisResult {
    return {
        games: [{ id: 0, name: "Half-Life", popularity: 100, GamivoPrice: 1.5, ...gameOverrides }],
        summary: { totalRequested: 1, foundGames: 1, worthyByPopularity: 1, foundPrices: 1, processingTimeSeconds: 0 },
    };
}

/** Item de listagem retornado por `TradePaginator.getTopicsFromPage`. */
function makeTopicRef(code: string, isClosed = false) {
    return { code, url: `https://steamtrades.com/trade/${code}`, isClosed };
}

function makeInput(overrides: Partial<FindNewSuppliersInput> = {}): FindNewSuppliersInput {
    const paginator = {
        getTopicsFromPage: vi.fn()
            .mockResolvedValueOnce([makeTopicRef("ABC")])
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

    it("forwards total_tf2_price from evaluate to commentPoster.post", async () => {
        const input = makeInput({
            profitabilityChecker: { evaluate: vi.fn().mockResolvedValue(makeProspectResult({ total_tf2_price: 12.34 })) },
        });

        await useCase.execute(input);

        expect(input.commentPoster.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Array),
            12.34,
        );
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

    it("forwards gamivo_id from the priced game to evaluate", async () => {
        const input = makeInput({
            gameSearcher: { search: vi.fn().mockResolvedValue(makeGameResult({ gamivo_id: "144601" })) },
        });

        await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).toHaveBeenCalledWith(
            expect.any(Object),
            [expect.objectContaining({ gamivo_id: "144601" })],
        );
    });

    it("sends null for gamivo_id when the priced game does not have it", async () => {
        const input = makeInput();

        await useCase.execute(input);

        const [, games] = (input.profitabilityChecker.evaluate as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(games[0].gamivo_id).toBeNull();
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

    it("skips topics where wantsTf2Key is false without calling profitabilityChecker", async () => {
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ wantsTf2Key: false })) },
        });

        const result = await useCase.execute(input);

        expect(input.profitabilityChecker.evaluate).not.toHaveBeenCalled();
        expect(result.suppliersCommented).toBe(0);
    });

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

    it("passes at most 1000 games to gameSearcher even when the topic has more", async () => {
        const manyGames = Array.from({ length: 1200 }, (_, i) => `Game ${i + 1}`);
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ games: manyGames })) },
        });

        await useCase.execute(input);

        const calledWith = input.gameSearcher.search.mock.calls[0][0].gameNames;
        expect(calledWith).toHaveLength(1000);
        expect(calledWith[0]).toBe("Game 1");
        expect(calledWith[999]).toBe("Game 1000");
    });

    it("passes all games when the topic has 1000 or fewer", async () => {
        const games = Array.from({ length: 30 }, (_, i) => `Game ${i + 1}`);
        const input = makeInput({
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ games })) },
        });

        await useCase.execute(input);

        const calledWith = input.gameSearcher.search.mock.calls[0][0].gameNames;
        expect(calledWith).toHaveLength(30);
    });

    // --- pagination ---

    it("stops pagination for each search term once a page returns no topics", async () => {
        const input = makeInput({
            paginator: {
                getTopicsFromPage: vi.fn().mockImplementation(async (page: number) =>
                    page === 1 ? [makeTopicRef("T1"), makeTopicRef("T2")] : [],
                ),
            },
        });

        const result = await useCase.execute(input);

        // Uma página com tópicos + uma página vazia (que interrompe) por termo de busca.
        expect(result.pagesVisited).toBe(TF2_SEARCH_TERMS.length * 2);
    });

    it("stops processing collected topics after MAX_CONSECUTIVE_INACTIVE inactive ones", async () => {
        const topics = ["T1", "T2", "T3", "T4", "T5"].map((code) => makeTopicRef(code));
        const input = makeInput({
            paginator: {
                getTopicsFromPage: vi.fn().mockImplementation(async (page: number) => (page === 1 ? topics : [])),
            },
            scraper: { scrape: vi.fn().mockResolvedValue(makeTopic({ isInactive: true })) },
        });

        const result = await useCase.execute(input);

        expect(result.topicsProcessed).toBe(5);
        expect(input.commentPoster.post).not.toHaveBeenCalled();
    });

    // --- closed listings (cadeado na listagem, distinto de isInactive do tópico aberto) ---

    it("does not collect a closed topic for processing", async () => {
        const input = makeInput({
            paginator: {
                getTopicsFromPage: vi.fn()
                    .mockResolvedValueOnce([makeTopicRef("CLOSED", true), makeTopicRef("OPEN", false)])
                    .mockResolvedValue([]),
            },
        });

        await useCase.execute(input);

        expect(input.scraper.scrape).toHaveBeenCalledTimes(1);
        expect(input.scraper.scrape).toHaveBeenCalledWith("https://steamtrades.com/trade/OPEN");
    });

    it("stops paginating a search term after MAX_CONSECUTIVE_CLOSED closed listings in a row, without fetching further pages", async () => {
        const closedTopics = Array.from({ length: 5 }, (_, i) => makeTopicRef(`CLOSED${i + 1}`, true));
        const getTopicsFromPage = vi.fn().mockResolvedValue(closedTopics);
        const input = makeInput({ paginator: { getTopicsFromPage } });

        const result = await useCase.execute(input);

        // Um fetch por termo — os 5 fechados já vêm na primeira página, então a segunda nunca é buscada.
        expect(getTopicsFromPage).toHaveBeenCalledTimes(TF2_SEARCH_TERMS.length);
        expect(result.pagesVisited).toBe(TF2_SEARCH_TERMS.length);
        expect(input.scraper.scrape).not.toHaveBeenCalled();
    });

    it("resets the consecutive-closed counter when an open topic appears in between", async () => {
        const topics = [
            makeTopicRef("C1", true),
            makeTopicRef("C2", true),
            makeTopicRef("C3", true),
            makeTopicRef("C4", true),
            makeTopicRef("OPEN", false),
            makeTopicRef("C5", true),
            makeTopicRef("C6", true),
            makeTopicRef("C7", true),
            makeTopicRef("C8", true),
        ];
        const input = makeInput({
            paginator: {
                getTopicsFromPage: vi.fn().mockResolvedValueOnce(topics).mockResolvedValue([]),
            },
        });

        await useCase.execute(input);

        // Nenhuma sequência bate 5 fechados seguidos (o OPEN no meio zera o contador).
        expect(input.scraper.scrape).toHaveBeenCalledTimes(1);
        expect(input.scraper.scrape).toHaveBeenCalledWith("https://steamtrades.com/trade/OPEN");
    });

    // --- search coverage (have=<term>) ---

    it("queries the paginator once per TF2 search-term variant, not just a literal 'tf2' substring", async () => {
        const getTopicsFromPage = vi.fn().mockResolvedValue([]);
        const input = makeInput({ paginator: { getTopicsFromPage } });

        await useCase.execute(input);

        const termsQueried = new Set(getTopicsFromPage.mock.calls.map(([, searchTerm]) => searchTerm));
        expect(termsQueried).toEqual(new Set(TF2_SEARCH_TERMS));
    });

    // --- two-phase collection (bump mitigation) ---

    it("collects topics from every page and every search term before processing any of them", async () => {
        const callOrder: string[] = [];
        let uniqueCodeCounter = 0;
        const paginator = {
            getTopicsFromPage: vi.fn(async (page: number, searchTerm: string) => {
                callOrder.push(`page:${page}:${searchTerm}`);
                if (page > 1) return [];
                uniqueCodeCounter++;
                return [makeTopicRef(`T${uniqueCodeCounter}`)];
            }),
        };
        const scraper = {
            scrape: vi.fn(async (url: string) => {
                callOrder.push(`scrape:${url}`);
                return makeTopic();
            }),
        };
        const input = makeInput({ paginator, scraper });

        await useCase.execute(input);

        const firstScrapeIndex = callOrder.findIndex((entry) => entry.startsWith("scrape:"));
        const pageEntries = callOrder.filter((entry) => entry.startsWith("page:"));

        expect(firstScrapeIndex).toBeGreaterThan(-1);
        expect(callOrder.slice(0, firstScrapeIndex)).toEqual(pageEntries);
        // page 1 (com tópico) + page 2 (vazia, interrompe) por termo.
        expect(pageEntries).toHaveLength(TF2_SEARCH_TERMS.length * 2);
    });

    it("processes a topic only once even when its code appears on more than one page or search term", async () => {
        const paginator = {
            getTopicsFromPage: vi.fn().mockImplementation(async (page: number) =>
                page === 1 ? [makeTopicRef("DUP")] : [],
            ),
        };
        const input = makeInput({ paginator });

        await useCase.execute(input);

        expect(input.scraper.scrape).toHaveBeenCalledTimes(1);
    });
});
