import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import type { TopicScraper } from "@/application/suppliers/ports/topic-scraper.port.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { ProfitabilityChecker, GamePriceInput, SupplierInput } from "@/application/suppliers/ports/profitability-checker.port.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { formatResult } from "@/domain/suppliers/profitability.js";

const MAX_PAGES = 100;
const MAX_CONSECUTIVE_INACTIVE = 5;
const MIN_POPULARITY = 30;
const MAX_GAMES_PER_SUPPLIER = 50;

export type FindNewSuppliersInput = {
    paginator: TradePaginator;
    scraper: TopicScraper;
    commentPoster: CommentPoster;
    profitabilityChecker: ProfitabilityChecker;
    gameSearcher: GameSearcher;
    ignoredSteamId: string | null;
};

export type FindNewSuppliersResult = {
    pagesVisited: number;
    topicsProcessed: number;
    suppliersCommented: number;
};

/**
 * Varre as páginas de listagem do SteamTrades em busca de fornecedores potenciais.
 *
 * Para cada tópico encontrado:
 * 1. Verifica se está inativo (`.notification.yellow`) — pula e incrementa o contador de inatividade.
 * 2. Extrai os jogos da seção `.have` e busca preços via GameSearcher.
 * 3. Envia os dados ao Sistema Estoque para avaliação de rentabilidade e decisão de comentar.
 * 4. Se `should_comment === true`, posta comentário.
 *
 * Para antecipadamente quando 5 tópicos inativos são encontrados em sequência.
 */
export class FindNewSuppliersUseCase {
    async execute(input: FindNewSuppliersInput): Promise<FindNewSuppliersResult> {
        const { paginator, scraper, commentPoster, profitabilityChecker, gameSearcher, ignoredSteamId } = input;

        let pagesVisited = 0;
        let topicsProcessed = 0;
        let suppliersCommented = 0;
        let consecutiveInactive = 0;

        outer: for (let page = 1; page <= MAX_PAGES; page++) {
            console.log(`📄 [SUPPLIERS] Scanning page ${page}/${MAX_PAGES}...`);
            pagesVisited++;

            const topics = await paginator.getTopicsFromPage(page);

            if (topics.length === 0) {
                console.log(`⚠️ [SUPPLIERS] Page ${page} has no topics. Stopping.`);
                break;
            }

            for (const { code, url } of topics) {
                try {
                    const topic = await scraper.scrape(url);

                    if (topic.isInactive) {
                        consecutiveInactive++;
                        console.log(`💤 [SUPPLIERS] Topic ${code} is inactive (${consecutiveInactive}/${MAX_CONSECUTIVE_INACTIVE} consecutive).`);
                        topicsProcessed++;

                        if (consecutiveInactive >= MAX_CONSECUTIVE_INACTIVE) {
                            console.log(`🛑 [SUPPLIERS] ${MAX_CONSECUTIVE_INACTIVE} consecutive inactive topics. Stopping pagination.`);
                            break outer;
                        }
                        continue;
                    }

                    consecutiveInactive = 0;

                    if (!topic.steamId) {
                        console.warn(`⚠️ [SUPPLIERS] Steam ID not found in topic ${code}. Skipping.`);
                        continue;
                    }

                    if (ignoredSteamId && topic.steamId === ignoredSteamId) {
                        console.log(`🚫 [SUPPLIERS] Steam ID ${topic.steamId} is in the ignore list. Skipping topic ${code}.`);
                        continue;
                    }

                    if (topic.games.length === 0) {
                        topicsProcessed++;
                        console.log(`⚠️ [SUPPLIERS] Topic ${code} has no games in .have section.`);
                        continue;
                    }

                    const gameNames = topic.games.slice(0, MAX_GAMES_PER_SUPPLIER);
                    console.log(`🔍 [SUPPLIERS] Searching prices for ${gameNames.length}/${topic.games.length} game(s) in topic ${code}...`);

                    const searchResult = await gameSearcher.search({
                        gameNames,
                        minPopularity: MIN_POPULARITY,
                        checkGamivoOffer: true,
                    });

                    const gamesWithPrice: GamePriceInput[] = searchResult.games
                        .filter((g) => g.GamivoPrice != null)
                        .map((g) => ({
                            name: g.name,
                            price_euro: g.GamivoPrice as number,
                            popularity: g.popularity,
                            region: g.region ?? null,
                        }));

                    if (gamesWithPrice.length === 0) {
                        topicsProcessed++;
                        console.log(`💸 [SUPPLIERS] No prices found for games in topic ${code}.`);
                        continue;
                    }

                    const supplier: SupplierInput = {
                        steam_id: topic.steamId,
                        list_code: code,
                    };

                    const { profitable: profitableGames, is_added, should_comment, last_commented_at, games_changed } =
                        await profitabilityChecker.evaluate(supplier, gamesWithPrice);

                    console.log(`📊 [SUPPLIERS] Topic ${code}: should_comment=${should_comment}, games_changed=${games_changed}, last_commented_at=${last_commented_at ?? "never"}`);

                    if (!should_comment) {
                        topicsProcessed++;
                        console.log(`⏭️ [SUPPLIERS] Sistema Estoque decided not to comment on topic ${code}.`);
                        continue;
                    }

                    const formatted = formatResult(profitableGames);
                    console.log(`✅ [SUPPLIERS] Commenting on topic ${code} (is_added=${is_added}):\n${formatted}`);

                    await commentPoster.post(url, profitableGames);
                    topicsProcessed++;
                    suppliersCommented++;
                    console.log(`✅ [SUPPLIERS] Commented on ${code} with ${profitableGames.length} profitable game(s).`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`❌ [SUPPLIERS] Failed to process topic ${code}: ${message}`);
                    topicsProcessed++;
                }
            }
        }

        return { pagesVisited, topicsProcessed, suppliersCommented };
    }
}
