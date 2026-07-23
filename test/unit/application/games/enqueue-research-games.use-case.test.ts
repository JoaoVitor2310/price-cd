import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnqueueResearchGamesUseCase } from "@/application/games/enqueue-research-games.use-case.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ResearchGamesRequest> = {}): ResearchGamesRequest {
    return {
        gameNames: ["Half-Life"],
        minPopularity: 30,
        checkGamivoOffer: true,
        supplierSteamId: "76561198888888888",
        listCode: "G0eXM",
        title: "Trade from supplier X",
        ...overrides,
    };
}

/** Scheduler fake que captura a task em vez de executá-la, permitindo controlar o momento. */
function makeScheduler() {
    let captured: (() => Promise<void>) | undefined;
    return {
        schedule: vi.fn((task: () => Promise<void>) => {
            captured = task;
        }),
        runScheduledTask: () => {
            if (!captured) throw new Error("No task was scheduled");
            return captured();
        },
    };
}

// ---------------------------------------------------------------------------

describe("EnqueueResearchGamesUseCase", () => {
    let useCase: EnqueueResearchGamesUseCase;

    beforeEach(() => {
        useCase = new EnqueueResearchGamesUseCase();
    });

    it("schedules the work instead of running it inline", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockResolvedValue(undefined) };

        await useCase.execute({ request: makeRequest(), scheduler, runner });

        expect(scheduler.schedule).toHaveBeenCalledTimes(1);
        expect(runner.run).not.toHaveBeenCalled();
    });

    it("passes the request through to the runner when the scheduled task runs", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockResolvedValue(undefined) };
        const request = makeRequest({ title: "Specific trade" });

        await useCase.execute({ request, scheduler, runner });
        await scheduler.runScheduledTask();

        expect(runner.run).toHaveBeenCalledWith(request);
    });

    it("does not wait for the runner before resolving", async () => {
        const scheduler = makeScheduler();
        let resolveRunner: (() => void) | undefined;
        const runner = {
            run: vi.fn(() => new Promise<void>((resolve) => {
                resolveRunner = resolve;
            })),
        };

        await useCase.execute({ request: makeRequest(), scheduler, runner });

        // A execução já retornou mesmo com o runner ainda pendente.
        expect(scheduler.schedule).toHaveBeenCalledTimes(1);

        const pending = scheduler.runScheduledTask();
        resolveRunner?.();
        await pending;
    });

    it("swallows runner errors so the background queue is not broken", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockRejectedValue(new Error("scraping failed")) };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await useCase.execute({ request: makeRequest(), scheduler, runner });

        await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });
});
