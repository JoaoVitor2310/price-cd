import { describe, it, expect, vi } from "vitest";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { EnqueueResearchGamesUseCase } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import type { ResearchGamesRequest } from "@/application/games/ports/research-games-runner.port.js";
import type { ResearchQueue } from "@/application/games/ports/research-queue.port.js";

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<ResearchGamesRequest> = {}): ResearchGamesRequest {
    return {
        gameNames: ["Half-Life"],
        criteria: resolveSearchCriteria("default", { checkGamivoOffer: true }),
        supplierSteamId: "76561198888888888",
        listCode: "G0eXM",
        title: "Trade from supplier X",
        ...overrides,
    };
}

function makeQueue(enqueue: ResearchQueue["enqueue"] = vi.fn().mockResolvedValue(undefined)) {
    return { enqueue: vi.fn(enqueue), status: vi.fn().mockResolvedValue("up") } satisfies ResearchQueue;
}

// ---------------------------------------------------------------------------

describe("EnqueueResearchGamesUseCase", () => {
    it("hands the request to the queue as data", async () => {
        const queue = makeQueue();
        const request = makeRequest({ title: "Specific trade" });

        await new EnqueueResearchGamesUseCase(queue).execute({ request });

        expect(queue.enqueue).toHaveBeenCalledTimes(1);
        expect(queue.enqueue).toHaveBeenCalledWith(request);
    });

    it("resolves only after the queue has stored the request", async () => {
        let store: (() => void) | undefined;
        const queue = makeQueue(() => new Promise<void>((resolve) => {
            store = resolve;
        }));

        let resolved = false;
        const pending = new EnqueueResearchGamesUseCase(queue)
            .execute({ request: makeRequest() })
            .then(() => {
                resolved = true;
            });

        // O 202 só pode sair depois de o pedido estar guardado.
        await Promise.resolve();
        expect(resolved).toBe(false);

        store?.();
        await pending;
        expect(resolved).toBe(true);
    });

    it("propagates a failure to store the request, so the caller does not get a 202", async () => {
        const queue = makeQueue(() => Promise.reject(new Error("Stream isn't writeable")));

        await expect(
            new EnqueueResearchGamesUseCase(queue).execute({ request: makeRequest() }),
        ).rejects.toThrow("Stream isn't writeable");
    });
});
