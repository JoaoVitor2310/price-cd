import { formatGameResultLine } from "@/helpers/format-game-result.js";
import type { ProfitableGameResult } from "@/application/suppliers/ports/profitability-checker.port.js";

/** Serializa a lista de jogos rentáveis em texto formatado para salvar no banco (`topics.result`). */
export function formatResult(games: ProfitableGameResult[]): string {
    return games
        .map((g) =>
            formatGameResultLine({
                name: g.name,
                price: g.price_euro.toFixed(2).replace(".", ","),
                popularity: g.popularity,
                region: g.region,
            })
        )
        .join("\n");
}
