import type { GameTradeImporter, GameTradeInput, GameTradeOptions } from "@/application/games/ports/game-trade-importer.port.js";

const TRADE_ENDPOINT = "/trades/from-price-researcher";
const TIMEOUT_MS = 15_000;

export class HttpGameTradeImporter implements GameTradeImporter {
    constructor(
        private readonly baseUrl: string,
        private readonly bearerToken: string,
    ) {}

    async import(games: GameTradeInput[], options?: GameTradeOptions): Promise<void> {
        const url = `${this.baseUrl}${TRADE_ENDPOINT}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const payload: Record<string, unknown> = { games };
        if (options?.supplier_steam_id) payload.supplier_steam_id = options.supplier_steam_id;
        if (options?.list_code) payload.list_code = options.list_code;

        try {
            const response = await fetch(url, {
                method: "POST",
                signal: controller.signal,
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.bearerToken}`,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => undefined);
                console.error(`❌ [TRADE IMPORTER] HTTP ${response.status} — POST ${url}`);
                console.error(`❌ [TRADE IMPORTER] Response body:`, body);
                throw new Error(`POST ${url} failed with status ${response.status}`);
            }

            await response.body?.cancel();
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                console.error(`❌ [TRADE IMPORTER] Request timed out — POST ${url}`);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }
}
