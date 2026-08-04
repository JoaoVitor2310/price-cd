import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/enqueue-find-new-suppliers.use-case.js";
import type { FindNewSuppliersResult } from "@/application/suppliers/find-new-suppliers.use-case.js";

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
    let useCase: EnqueueFindNewSuppliersUseCase;

    beforeEach(() => {
        useCase = new EnqueueFindNewSuppliersUseCase();
    });

    it("schedules the work instead of running it inline", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockResolvedValue(makeResult()) };

        await useCase.execute({ scheduler, runner });

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

        await useCase.execute({ scheduler, runner });

        // A execução já retornou mesmo com o runner ainda pendente.
        expect(scheduler.schedule).toHaveBeenCalledTimes(1);

        const pending = scheduler.runScheduledTask();
        resolveRunner?.(makeResult());
        await pending;
    });

    it("swallows runner errors so the background queue is not broken", async () => {
        const scheduler = makeScheduler();
        const runner = { run: vi.fn().mockRejectedValue(new Error("scraping failed")) };
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

        await useCase.execute({ scheduler, runner });

        await expect(scheduler.runScheduledTask()).resolves.toBeUndefined();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it("logs a summary when the runner finishes successfully", async () => {
        const scheduler = makeScheduler();
        const result = makeResult({ pagesVisited: 5, topicsProcessed: 20, suppliersCommented: 4 });
        const runner = { run: vi.fn().mockResolvedValue(result) };
        const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

        await useCase.execute({ scheduler, runner });
        await scheduler.runScheduledTask();

        expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("5"));

        consoleLog.mockRestore();
    });
});
