import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import type { TopicScraper } from "@/application/suppliers/ports/topic-scraper.port.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { SupplierRepository } from "@/application/suppliers/ports/supplier-repository.port.js";
import type { ProfitabilityChecker, GamePriceInput } from "@/application/suppliers/ports/profitability-checker.port.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { formatResult } from "@/domain/suppliers/profitability.js";

const MAX_PAGES = 100;
const MAX_CONSECUTIVE_INACTIVE = 5;
const MIN_POPULARITY = 30;

export type FindNewSuppliersInput = {
    paginator: TradePaginator;
    scraper: TopicScraper;
    commentPoster: CommentPoster;
    repository: SupplierRepository;
    profitabilityChecker: ProfitabilityChecker;
    gameSearcher: GameSearcher;
};

export type FindNewSuppliersResult = {
    pagesVisited: number;
    topicsProcessed: number;
    suppliersCommented: number;
};

export class FindNewSuppliersUseCase {
    async execute(input: FindNewSuppliersInput): Promise<FindNewSuppliersResult> {
        const { paginator, scraper, commentPoster, repository, profitabilityChecker, gameSearcher } = input;

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
                let supplierId: number | undefined;
                try {
                    const topic = await scraper.scrape(url);

                    if (topic.isInactive) {
                        consecutiveInactive++;
                        console.log(`💤 [SUPPLIERS] Topic ${code} is inactive (${consecutiveInactive}/${MAX_CONSECUTIVE_INACTIVE} consecutive).`);

                        supplierId = repository.upsertSupplier(topic.steamId || `unknown-${code}`);
                        repository.saveTopic({ supplier_id: supplierId, code, status: "inactive", result: null });
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

                    supplierId = repository.upsertSupplier(topic.steamId);

                    if (topic.hasRecentComment) {
                        repository.saveTopic({ supplier_id: supplierId, code, status: "skipped_user", result: null });
                        topicsProcessed++;
                        console.log(`⏭️ [SUPPLIERS] Already commented recently on topic ${code}. Skipping.`);
                        continue;
                    }

                    if (topic.games.length === 0) {
                        repository.saveTopic({ supplier_id: supplierId, code, status: "no_games", result: null });
                        topicsProcessed++;
                        console.log(`⚠️ [SUPPLIERS] Topic ${code} has no games in .have section.`);
                        continue;
                    }

                    console.log(`🔍 [SUPPLIERS] Searching prices for ${topic.games.length} game(s) in topic ${code}...`);

                    const searchResult = await gameSearcher.search({
                        gameNames: topic.games,
                        minPopularity: MIN_POPULARITY,
                        checkGamivoOffer: true,
                    });

                    const gamesWithPrice: GamePriceInput[] = searchResult.games
                        .filter((g) => g.GamivoPrice != null)
                        .map((g) => ({
                            name: g.name,
                            priceEur: parseFloat(String(g.GamivoPrice).replace(",", ".")),
                            popularity: g.popularity,
                            region: g.region ?? null,
                        }));

                    if (gamesWithPrice.length === 0) {
                        repository.saveTopic({ supplier_id: supplierId, code, status: "not_profitable", result: null });
                        topicsProcessed++;
                        console.log(`💸 [SUPPLIERS] No prices found for games in topic ${code}.`);
                        continue;
                    }

                    const profitableGames = await profitabilityChecker.evaluate(gamesWithPrice);

                    if (profitableGames.length === 0) {
                        repository.saveTopic({ supplier_id: supplierId, code, status: "not_profitable", result: null });
                        topicsProcessed++;
                        console.log(`💸 [SUPPLIERS] No profitable games in topic ${code} according to Sistema Estoque.`);
                        continue;
                    }

                    const result = formatResult(profitableGames);

                    await commentPoster.post(url, profitableGames);

                    repository.saveTopic({ supplier_id: supplierId, code, status: "commented", result });
                    topicsProcessed++;
                    suppliersCommented++;

                    console.log(`✅ [SUPPLIERS] Commented on ${code} with ${profitableGames.length} profitable game(s).`);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`❌ [SUPPLIERS] Failed to process topic ${code}: ${message}`);
                    if (supplierId !== undefined) {
                        repository.saveTopic({ supplier_id: supplierId, code, status: "failed", result: message });
                    }
                    topicsProcessed++;
                }
            }
        }

        return { pagesVisited, topicsProcessed, suppliersCommented };
    }
}
