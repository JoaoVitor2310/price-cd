import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/use-cases/enqueue-find-new-suppliers.use-case.js";
import type { FindNewSuppliersResult } from "@/application/suppliers/use-cases/find-new-suppliers.use-case.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeResult(overrides: Partial<FindNewSuppliersResult> = {}): FindNewSuppliersResult {
    return {
        pagesVisited: 3,
        topicsProcessed: 10,
        suppliersCommented: 2,
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

describe("EnqueueFindNewSuppliersUseCase", () => {
    // O use case nasce dentro de cada teste: scheduler e runner agora entram
    // pelo construtor, e cada caso monta os seus.

    it("schedules the work instead of running it inline", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockResolvedValue(makeResult()) };
        const useCase = new EnqueueFindNewSuppliersUseCase(scheduler, runner);

        await useCase.execute();

        expect(scheduler.schedule).toHaveBeenCalledTimes(1);
        expect(runner.run).not.toHaveBeenCalled();
    });

    it("does not wait for the runner before resolving", async () => {
        const scheduler = makeScheduler();
        let resolveRunner: ((result: FindNewSuppliersResult) => void) | undefined;
        const runner = {
            run: vi.fn(() => new Promise<FindNewSuppliersResult>((resolve) => {
                resolveRunner = resolve;
            })),
        };
        const useCase = new EnqueueFindNewSuppliersUseCase(scheduler, runner);

        await useCase.execute();

        // A execução já retornou mesmo com o runner ainda pendente.
        expect(scheduler.schedule).toHaveBeenCalledTimes(1);

        const pending = scheduler.runScheduledTask();
        resolveRunner?.(makeResult());
        await pending;
    });

    it("swallows runner errors so the background queue is not broken", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockRejectedValue(new Error("scraping failed")) };
        const useCase = new EnqueueFindNewSuppliersUseCase(scheduler, runner);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await useCase.execute();

        await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it("logs a summary when the runner finishes successfully", async () => {
        const scheduler = makeScheduler();
        const result = makeResult({ pagesVisited: 5, topicsProcessed: 20, suppliersCommented: 4 });
        const runner = { run: vi.fn().mockResolvedValue(result) };
        const useCase = new EnqueueFindNewSuppliersUseCase(scheduler, runner);
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

        await useCase.execute();
        await scheduler.runScheduledTask();

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("5"));

        consoleLog.mockRestore();
    });
});
