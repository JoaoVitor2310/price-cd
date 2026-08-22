import { FindNewSuppliersUseCase } from "@/application/suppliers/find-new-suppliers.use-case.js";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/enqueue-find-new-suppliers.use-case.js";
import { PuppeteerTradePaginator } from "@/infrastructure/suppliers/puppeteer-trade-paginator.js";
import { PuppeteerTopicScraper } from "@/infrastructure/suppliers/puppeteer-topic-scraper.js";
import { PuppeteerCommentPoster } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import { HttpProfitabilityChecker } from "@/infrastructure/suppliers/http-profitability-checker.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { getSuppliersSession, cleanupSuppliersSession } from "@/lib/puppeteer-browser.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import type { GameAnalysisResult, SearchGamesRequest } from "@/application/games/game.types.js";
import type { FindNewSuppliersResult } from "@/application/suppliers/find-new-suppliers.use-case.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import { parseEnvList } from "@/helpers/parse-env-list.js";

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

    // Aceita um ou vários Steam IDs: `USER_TO_IGNORE=765...1,765...2`.
    const ignoredSteamIds = new Set(parseEnvList(process.env.USER_TO_IGNORE));

    const useCase = new FindNewSuppliersUseCase();
    const paginator = new PuppeteerTradePaginator();
    const scraper = new PuppeteerTopicScraper();
    const commentPoster = new PuppeteerCommentPoster();
    const profitabilityChecker = new HttpProfitabilityChecker(profitabilityApiUrl, externalSecret);
    const gameSearcher = new GameSearcherAdapter();

    return {
        async run(): Promise<FindNewSuppliersResult> {
            try {
                // Inject auth cookie before any navigation — same pattern as PuppeteerSteamTradesBumper.
                // The server always responds with set-cookie, so the cookie must be set first
                // to prevent unauthenticated page visits from overwriting it.
                const browserSession = await getSuppliersSession();
                await browserSession.page.browserContext().setCookie({
                    name: "PHPSESSID",
                    value: session,
                    domain: "www.steamtrades.com",
                    path: "/",
                    httpOnly: true,
                    secure: false,
                });

                return await useCase.execute({
                    paginator,
                    scraper,
                    commentPoster,
                    profitabilityChecker,
                    gameSearcher,
                    ignoredSteamIds,
                });
            } finally {
                await cleanupSuppliersSession();
            }
        },
    };
}

/**
 * Fila própria da descoberta de fornecedores, separada das filas de `lists` e `research`:
 * uma varredura longa do SteamTrades não deve competir por concorrência com outros fluxos.
 * Concorrência 1 — o scraping já é serializado por um único browser Puppeteer compartilhado.
 */
let _scheduler: BackgroundScheduler | undefined;

function getScheduler(): BackgroundScheduler {
    if (!_scheduler) {
        _scheduler = new LimitedConcurrencyScheduler(1);
    }
    return _scheduler;
}

const enqueueFindNewSuppliersUseCase = new EnqueueFindNewSuppliersUseCase();

/**
 * Enfileira a descoberta de fornecedores e retorna imediatamente.
 * A montagem das dependências (e a validação das env vars) acontece aqui, ainda
 * no ciclo da requisição — falha cedo se a configuração estiver incompleta,
 * porque depois de enfileirado não há mais ninguém para receber o erro.
 */
export function enqueueFindNewSuppliersService(): Promise<void> {
    return enqueueFindNewSuppliersUseCase.execute({
        scheduler: getScheduler(),
        runner: createFindNewSuppliersRunner(),
    });
}
