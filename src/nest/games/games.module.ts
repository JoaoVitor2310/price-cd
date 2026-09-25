import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EnqueueResearchGamesUseCase } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";
import { ResearchGamesUseCase } from "@/application/games/use-cases/research-games.use-case.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { SearchGamesUseCase } from "@/application/games/use-cases/search-games.use-case.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type { Env } from "@/config/env.schema.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";
import { LazyGameTradeImporter } from "@/infrastructure/games/lazy-game-trade-importer.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { GamesController } from "@/nest/games/games.controller.js";
import {
	RESEARCH_RUNNER,
	RESEARCH_SCHEDULER,
} from "@/nest/games/games.tokens.js";

/**
 * O wiring das rotas de `games` — o que `src/services/games/` fazia à mão.
 *
 * Três formas de provider convivem aqui, e a diferença não é estilo:
 *
 * - **Adapters sem configuração** (`useClass`): podem ter `@Injectable()` (o ADR
 *   0004 permite em `infrastructure/`), então o container os constrói sozinho.
 *   A porta (`abstract class`) é o token.
 *
 * - **Adapters COM configuração** (`useFactory` + `inject: [ConfigService]`):
 *   `HttpGameTradeImporter` precisa de URL e secret. O decorator não ajudaria —
 *   o container não tem como adivinhar de onde vêm duas strings.
 *
 * - **Use cases de `application/`** (`useFactory` + `inject`): `application/`
 *   **não pode** importar `@nestjs/*`, nem `@Injectable()`. Sem decorator o
 *   TypeScript não emite `design:paramtypes`, então a lista `inject` é essa
 *   informação, escrita à mão.
 */
@Module({
	controllers: [GamesController],
	providers: [
		{ provide: PopularityFetcher, useClass: SteamChartsPopularityFetcher },
		{ provide: PriceFetcher, useClass: AllKeyShopPriceFetcher },

		/**
		 * Construção **preguiçosa**, não no boot.
		 *
		 * Construir aqui derrubaria o app inteiro quando `SISTEMA_ESTOQUE_URL`
		 * faltasse — e o Express sobe nessa situação, servindo `/research` em modo
		 * demo (verificado: o Nest morria no boot enquanto o Express respondia).
		 * A checagem acontece no caminho autenticado, dentro da requisição, igual
		 * ao `assertTradeImporterConfigured()` do Express.
		 */
		{
			provide: GameTradeImporter,
			useFactory: (config: ConfigService<Env, true>) =>
				new LazyGameTradeImporter(() => {
					const baseUrl = config.get("SISTEMA_ESTOQUE_URL", { infer: true });
					const secret = config.get("EXTERNAL_SECRET", { infer: true });

					if (!baseUrl) throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");
					if (!secret) throw new Error("EXTERNAL_SECRET is not defined in .env");

					return new HttpGameTradeImporter(baseUrl, secret);
				}),
			inject: [ConfigService],
		},

		/**
		 * O motor de precificação, compartilhado pelos dois use cases de `games`
		 * — e, a partir dos PRs 5 e 6, por `lists` e `suppliers`. Singleton, como
		 * todo provider: uma instância serve todos.
		 */
		{
			provide: PriceGames,
			useFactory: (popularity: PopularityFetcher, price: PriceFetcher) =>
				new PriceGames(popularity, price),
			inject: [PopularityFetcher, PriceFetcher],
		},
		{
			provide: SearchGamesUseCase,
			useFactory: (priceGames: PriceGames) => new SearchGamesUseCase(priceGames),
			inject: [PriceGames],
		},
		{
			provide: ResearchGamesUseCase,
			useFactory: (priceGames: PriceGames, importer: GameTradeImporter) =>
				new ResearchGamesUseCase(priceGames, importer),
			inject: [PriceGames, GameTradeImporter],
		},

		/**
		 * A fila da pesquisa manual. Singleton (escopo default) **de propósito**:
		 * é estado compartilhado — o limite de concorrência 1 só significa algo se
		 * todas as requisições passarem pela mesma instância. Declarar este
		 * provider em dois módulos criaria duas filas de 1, ou seja, concorrência
		 * 2 sem ninguém perceber (`docs/nest-conceitos.md` §4).
		 *
		 * Concorrência fixa em 1, não configurável: o scraping do AllKeyShop já é
		 * serializado pelo browser compartilhado.
		 */
		{ provide: RESEARCH_SCHEDULER, useValue: new LimitedConcurrencyScheduler(1) },

		/**
		 * O que a fila executa. É só composição — nenhuma regra de negócio mora
		 * aqui, só a tradução "rodar a pesquisa completa, não em modo demo".
		 */
		{
			provide: RESEARCH_RUNNER,
			useFactory: (useCase: ResearchGamesUseCase): ResearchGamesRunner => ({
				run: async (request: ResearchGamesRequest) => {
					await useCase.execute({ ...request, demo: false });
				},
			}),
			inject: [ResearchGamesUseCase],
		},
		{
			provide: EnqueueResearchGamesUseCase,
			useFactory: (scheduler: BackgroundScheduler, runner: ResearchGamesRunner) =>
				new EnqueueResearchGamesUseCase(scheduler, runner),
			inject: [RESEARCH_SCHEDULER, RESEARCH_RUNNER],
		},
	],
	/**
	 * O que outros módulos podem consumir importando este.
	 *
	 * `ListsModule` (e `SuppliersModule`, no PR 6) precisam do motor de
	 * precificação e do importer de Trade. **Exportar é o caminho certo;
	 * redeclarar os providers lá seria o erro** — o mesmo provider declarado em
	 * dois módulos vira duas instâncias, e aqui isso significaria dois
	 * gerenciadores de sessão de browser no mesmo container
	 * (`docs/nest-conceitos.md` §4).
	 */
	exports: [PriceGames, GameTradeImporter],
})
export class GamesModule {}
