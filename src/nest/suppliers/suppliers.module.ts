import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SearchGamesRequest } from "@/application/games/game.types.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { FindNewSuppliersRunner } from "@/application/suppliers/ports/find-new-suppliers-runner.port.js";
import { ProfitabilityChecker } from "@/application/suppliers/ports/profitability-checker.port.js";
import { TopicScraper } from "@/application/suppliers/ports/topic-scraper.port.js";
import { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import { EnqueueFindNewSuppliersUseCase } from "@/application/suppliers/use-cases/enqueue-find-new-suppliers.use-case.js";
import { FindNewSuppliersUseCase } from "@/application/suppliers/use-cases/find-new-suppliers.use-case.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type { Env } from "@/config/env.schema.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import { HttpProfitabilityChecker } from "@/infrastructure/suppliers/http-profitability-checker.js";
import { LazyProfitabilityChecker } from "@/infrastructure/suppliers/lazy-profitability-checker.js";
import { PuppeteerCommentPoster } from "@/infrastructure/suppliers/puppeteer-comment-poster.js";
import { PuppeteerTopicScraper } from "@/infrastructure/suppliers/puppeteer-topic-scraper.js";
import { PuppeteerTradePaginator } from "@/infrastructure/suppliers/puppeteer-trade-paginator.js";
import { BrowserModule } from "@/nest/browser/browser.module.js";
import { GamesModule } from "@/nest/games/games.module.js";
import {
	IGNORED_STEAM_IDS,
	SUPPLIERS_RUNNER,
	SUPPLIERS_SCHEDULER,
} from "@/nest/suppliers/suppliers.tokens.js";
import { SuppliersController } from "@/nest/suppliers/suppliers.controller.js";

/**
 * O wiring da Descoberta de Fornecedores — o fluxo mais acoplado do sistema.
 *
 * `imports: [BrowserModule, GamesModule]`, nunca redeclarar os providers de lá.
 * Aqui isso não é preferência: `SuppliersBrowserSession` declarado de novo neste
 * módulo criaria um **segundo** gerenciador de Chromium num container com
 * `mem_limit: 2g` (`docs/nest-conceitos.md` §4).
 */
/**
 * As variáveis que a Descoberta exige, na ORDEM em que o Express as valida.
 *
 * A ordem é observável: a mensagem do 500 diz qual faltou, e quem falta primeiro
 * define o texto. Estava repetida em três lugares deste módulo.
 */
export const SUPPLIERS_REQUIRED_ENV = [
	"STEAMTRADES_SESSION",
	"SISTEMA_ESTOQUE_URL",
	"EXTERNAL_SECRET",
] as const;

/** Lança com a mesma mensagem do Express se alguma faltar. */
export function assertSuppliersEnv(config: ConfigService<Env, true>): void {
	for (const key of SUPPLIERS_REQUIRED_ENV) {
		if (!config.get(key, { infer: true })) {
			throw new Error(`${key} is not defined in .env`);
		}
	}
}

@Module({
	imports: [BrowserModule, GamesModule],
	controllers: [SuppliersController],
	providers: [
		{ provide: TradePaginator, useClass: PuppeteerTradePaginator },
		{ provide: TopicScraper, useClass: PuppeteerTopicScraper },
		{ provide: CommentPoster, useClass: PuppeteerCommentPoster },

		/**
		 * Construção **preguiçosa**, não no boot.
		 *
		 * Construir aqui derrubava o app inteiro quando faltava
		 * `SISTEMA_ESTOQUE_URL` — e o Express sobe nessa situação. Foi o mesmo
		 * erro cometido no PR 4 com o `GameTradeImporter`; o teste
		 * `boot-without-inventory.test.ts`, escrito lá, pegou este aqui.
		 */
		{
			provide: ProfitabilityChecker,
			useFactory: (config: ConfigService<Env, true>) =>
				new LazyProfitabilityChecker(() => {
					assertSuppliersEnv(config);

					return new HttpProfitabilityChecker(
						config.get("SISTEMA_ESTOQUE_URL", { infer: true }) as string,
						config.get("EXTERNAL_SECRET", { infer: true }) as string,
					);
				}),
			inject: [ConfigService],
		},

		/** A ponte entre subdomínios: `suppliers` pede preço, `games` precifica. */
		{
			provide: GameSearcher,
			useFactory: (priceGames: PriceGames): GameSearcher => ({
				search: async (request: SearchGamesRequest) =>
					(await priceGames.run(request)).priced,
			}),
			inject: [PriceGames],
		},

		{
			provide: IGNORED_STEAM_IDS,
			useFactory: (config: ConfigService<Env, true>) =>
				new Set(config.get("USER_TO_IGNORE", { infer: true })),
			inject: [ConfigService],
		},

		{
			provide: FindNewSuppliersUseCase,
			useFactory: (
				paginator: TradePaginator,
				scraper: TopicScraper,
				commentPoster: CommentPoster,
				profitabilityChecker: ProfitabilityChecker,
				gameSearcher: GameSearcher,
				ignoredSteamIds: ReadonlySet<string>,
			) =>
				new FindNewSuppliersUseCase(
					paginator,
					scraper,
					commentPoster,
					profitabilityChecker,
					gameSearcher,
					ignoredSteamIds,
				),
			inject: [
				TradePaginator,
				TopicScraper,
				CommentPoster,
				ProfitabilityChecker,
				GameSearcher,
				IGNORED_STEAM_IDS,
			],
		},

		/** Concorrência 1: o scraping já é serializado por um único browser. */
		{
			provide: SUPPLIERS_SCHEDULER,
			useValue: new LimitedConcurrencyScheduler(1),
		},

		/**
		 * O runner: injeta o cookie de sessão **antes de qualquer navegação** e
		 * limpa o browser no `finally`.
		 *
		 * A ordem do cookie não é negociável: o SteamTrades sempre responde com
		 * `set-cookie`, então uma visita não autenticada antes disto sobrescreveria
		 * a sessão. O `finally` também não: sem ele o Chromium da varredura fica
		 * vivo depois que a execução termina.
		 */
		{
			provide: SUPPLIERS_RUNNER,
			useFactory: (
				useCase: FindNewSuppliersUseCase,
				browser: SuppliersBrowserSession,
				config: ConfigService<Env, true>,
			): FindNewSuppliersRunner => ({
				run: async () => {
					assertSuppliersEnv(config);
					const session = config.get("STEAMTRADES_SESSION", { infer: true }) as string;

					try {
						const { page } = await browser.get();
						await page.browserContext().setCookie({
							name: "PHPSESSID",
							value: session,
							domain: "www.steamtrades.com",
							path: "/",
							httpOnly: true,
							secure: false,
						});

						return await useCase.execute();
					} finally {
						await browser.cleanup();
					}
				},
			}),
			inject: [FindNewSuppliersUseCase, SuppliersBrowserSession, ConfigService],
		},

		{
			provide: EnqueueFindNewSuppliersUseCase,
			useFactory: (
				scheduler: BackgroundScheduler,
				runner: FindNewSuppliersRunner,
			) => new EnqueueFindNewSuppliersUseCase(scheduler, runner),
			inject: [SUPPLIERS_SCHEDULER, SUPPLIERS_RUNNER],
		},
	],
})
export class SuppliersModule {}
