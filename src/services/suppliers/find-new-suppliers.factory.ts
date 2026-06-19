import { FindNewSuppliersUseCase } from "@/application/suppliers/find-new-suppliers.use-case.js";
import { PuppeteerTradePaginator } from "@/infrastructure/suppliers/puppeteer-trade-paginator.js";
import { PuppeteerTopicScraper } from "@/infrastructure/suppliers/puppeteer-topic-scraper.js";
import { PuppeteerCommentPoster } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import { HttpProfitabilityChecker } from "@/infrastructure/suppliers/http-profitability-checker.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";
import type { FindNewSuppliersResult } from "@/application/suppliers/find-new-suppliers.use-case.js";

/**
 * Adapta `SearchGamesUseCase` para a interface `GameSearcher` esperada pelo use case de suppliers.
 * Cria suas próprias instâncias de fetchers porque o fluxo de suppliers é independente
 * do upload de arquivos e não compartilha estado com outras requisições.
 */
class GameSearcherAdapter implements GameSearcher {
    private readonly useCase = new SearchGamesUseCase();
    private readonly popularityFetcher = new SteamChartsPopularityFetcher();
    private readonly priceFetcher = new AllKeyShopPriceFetcher();

    async search(request: SearchGamesRequest): Promise<GameAnalysisResult> {
        return this.useCase.execute({
            ...request,
            popularityFetcher: this.popularityFetcher,
            priceFetcher: this.priceFetcher,
        });
    }
}

/**
 * Constrói e conecta todas as dependências do fluxo de descoberta de fornecedores.
 * Valida as variáveis de ambiente obrigatórias antes de instanciar qualquer coisa,
 * falhando rápido em caso de configuração incompleta.
 *
 * @throws {Error} se `STEAMTRADES_SESSION` ou `SISTEMA_ESTOQUE_PROFITABILITY_URL` não estiverem definidos.
 */
export function createFindNewSuppliersRunner() {
    const session = process.env.STEAMTRADES_SESSION?.trim();
    if (!session) throw new Error("STEAMTRADES_SESSION não definido no .env");

    const profitabilityApiUrl = process.env.SISTEMA_ESTOQUE_PROFITABILITY_URL?.trim();
    if (!profitabilityApiUrl) throw new Error("SISTEMA_ESTOQUE_PROFITABILITY_URL não definido no .env");

    const useCase = new FindNewSuppliersUseCase();
    const repository = new SqliteSupplierRepository();
    const paginator = new PuppeteerTradePaginator();
    const scraper = new PuppeteerTopicScraper();
    const commentPoster = new PuppeteerCommentPoster(session);
    const profitabilityChecker = new HttpProfitabilityChecker(profitabilityApiUrl);
    const gameSearcher = new GameSearcherAdapter();

    return {
        run(): Promise<FindNewSuppliersResult> {
            return useCase.execute({
                paginator,
                scraper,
                commentPoster,
                repository,
                profitabilityChecker,
                gameSearcher,
            });
        },
    };
}
