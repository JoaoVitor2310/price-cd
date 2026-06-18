import { createFindNewSuppliersRunner } from "@/services/suppliers/find-new-suppliers.factory.js";

const INITIAL_DELAY_MS = 90_000; // 90s — after BUMP (60s) has already stabilized

/**
 * Starts the new suppliers search scheduler.
 * - First run 90s after server startup.
 * - Default interval: 24h (configurable via NEW_SUPPLIERS_INTERVAL_HOURS).
 * - Skips tick if previous run is still in progress.
 * - Does not start if STEAMTRADES_SESSION or SISTEMA_ESTOQUE_URL are not set.
 */
export function startFindNewSuppliersScheduler(): void {
    const session = process.env.STEAMTRADES_SESSION?.trim();

    if (!session) {
        console.warn("⚠️ [SUPPLIERS] Scheduler not started — set STEAMTRADES_SESSION in .env.");
        return;
    }

    const intervalHours = Number(process.env.NEW_SUPPLIERS_INTERVAL_HOURS) || 24;
    const intervalMs = intervalHours * 60 * 60 * 1000;

    const runner = createFindNewSuppliersRunner();
    let running = false;

    const run = async () => {
        if (running) {
            console.log("⏭️ [SUPPLIERS] Tick skipped — previous run still in progress.");
            return;
        }
        running = true;
        try {
            console.log("🔍 [SUPPLIERS] Starting automatic suppliers search...");
            const result = await runner.run();
            console.log(
                `✅ [SUPPLIERS] Search completed — ${result.suppliersCommented} commented out of ${result.topicsProcessed} topics processed.`
            );
        } catch (err) {
            console.error("❌ [SUPPLIERS] Scheduler error:", err);
        } finally {
            running = false;
        }
    };

    setTimeout(() => {
        void run();
        setInterval(() => void run(), intervalMs);
    }, INITIAL_DELAY_MS);

    console.log(`🚀 [SUPPLIERS] Scheduler started (interval: ${intervalHours}h, first run in ${INITIAL_DELAY_MS / 1000}s).`);
}
