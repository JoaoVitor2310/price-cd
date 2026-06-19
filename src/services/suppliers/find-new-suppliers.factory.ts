import { FindNewSuppliersUseCase } from "@/application/suppliers/find-new-suppliers.use-case.js";
import { PuppeteerTradePaginator } from "@/infrastructure/suppliers/puppeteer-trade-paginator.js";
import { PuppeteerTopicScraper } from "@/infrastructure/suppliers/puppeteer-topic-scraper.js";
import { PuppeteerCommentPoster } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import { HttpProfitabilityChecker } from "@/infrastructure/suppliers/http-profitability-checker.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { cleanupSuppliersSession } from "@/lib/puppeteer-browser.js";
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
 * O browser de suppliers é compartilhado entre paginator, scraper e poster durante
 * todo o `run()` — apenas uma `page` é aberta e fechada por operação, e o processo
 * Chrome é encerrado no `finally`, independente de sucesso ou erro.
 *
 * @throws {Error} se `STEAMTRADES_SESSION` ou `SISTEMA_ESTOQUE_URL` não estiverem definidos.
 */
export function createFindNewSuppliersRunner() {
    const session = process.env.STEAMTRADES_SESSION?.trim();
    if (!session) throw new Error("STEAMTRADES_SESSION is not defined in .env");

    const profitabilityApiUrl = process.env.SISTEMA_ESTOQUE_URL?.trim();
    if (!profitabilityApiUrl) throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");

    const externalSecret = process.env.EXTERNAL_SECRET?.trim();
    if (!externalSecret) throw new Error("EXTERNAL_SECRET is not defined in .env");

    const useCase = new FindNewSuppliersUseCase();
    const paginator = new PuppeteerTradePaginator();
    const scraper = new PuppeteerTopicScraper();
    const commentPoster = new PuppeteerCommentPoster(session);
    const profitabilityChecker = new HttpProfitabilityChecker(profitabilityApiUrl, externalSecret);
    const gameSearcher = new GameSearcherAdapter();

    return {
        async run(): Promise<FindNewSuppliersResult> {
            try {
                return await useCase.execute({
                    paginator,
                    scraper,
                    commentPoster,
                    profitabilityChecker,
                    gameSearcher,
                });
            } finally {
                await cleanupSuppliersSession();
            }
        },
    };
}
