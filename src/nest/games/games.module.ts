import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	CatalogPriceSource,
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import type { ResearchGamesRunner } from "@/application/games/ports/research-games-runner.port.js";
import { PriceCache } from "@/application/games/ports/price-cache.port.js";
import { ResearchQueue } from "@/application/games/ports/research-queue.port.js";
import { ResearchResultNotifier } from "@/application/games/ports/research-result-notifier.port.js";
import { TradeWithOfferCreator } from "@/application/games/ports/trade-with-offer-creator.port.js";
import { CachedPriceFetcher } from "@/application/games/services/cached-price-fetcher.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { ReadTopicGames } from "@/application/games/services/read-topic-games.js";
import { EnqueueResearchGamesUseCase } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import { CreateResearchTrade } from "@/application/games/services/create-research-trade.js";
import { ResearchGamesUseCase } from "@/application/games/use-cases/research-games.use-case.js";
import { RunResearchJobUseCase } from "@/application/games/use-cases/run-research-job.use-case.js";
import { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import type { Env } from "@/config/env.schema.js";
import { createBullmqResearchQueue } from "@/infrastructure/background/bullmq-research-queue.js";
import { createBullmqWebhookQueue } from "@/infrastructure/background/bullmq-webhook-queue.js";
import { InMemoryResearchQueue } from "@/infrastructure/background/in-memory-research-queue.js";
import { InMemoryWebhookNotifier } from "@/infrastructure/background/in-memory-webhook-notifier.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";
import { HttpTradeWithOfferCreator } from "@/infrastructure/games/http-trade-with-offer-creator.js";
import { LazyGameTradeImporter } from "@/infrastructure/games/lazy-game-trade-importer.js";
import { LazyTradeWithOfferCreator } from "@/infrastructure/games/lazy-trade-with-offer-creator.js";
import { NoopPriceCache } from "@/infrastructure/games/noop-price-cache.js";
import { createRedisPriceCache } from "@/infrastructure/games/redis-price-cache.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { HttpWebhookSender } from "@/infrastructure/webhooks/http-webhook-sender.js";
import { BrowserModule } from "@/nest/browser/browser.module.js";
import { GamesController } from "@/nest/games/games.controller.js";
import { RESEARCH_RUNNER } from "@/nest/games/games.tokens.js";
import { ListTopicModule } from "@/nest/lists/list-topic.module.js";

/** As duas Trades falam com o mesmo Estoque; faltando algo, a falha é no primeiro uso. */
const stockCredentials = (config: ConfigService<Env, true>) => {
	const baseUrl = config.get("SISTEMA_ESTOQUE_URL", { infer: true });
	const secret = config.get("EXTERNAL_SECRET", { infer: true });

	if (!baseUrl) throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");
	if (!secret) throw new Error("EXTERNAL_SECRET is not defined in .env");

	return { baseUrl, secret };
};

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
	// `AllKeyShopPriceFetcher` recebe a `SharedBrowserSession` pelo construtor;
	// quem é dono dela é o `BrowserModule`. Importar é obrigatório — redeclarar
	// o provider aqui criaria uma SEGUNDA sessão de Chromium
	// (`docs/nest-conceitos.md` §4).
	imports: [BrowserModule, ListTopicModule],
	controllers: [GamesController],
	providers: [
		{ provide: PopularityFetcher, useClass: SteamChartsPopularityFetcher },
		{ provide: CatalogPriceSource, useClass: AllKeyShopPriceFetcher },

		/**
		 * O cache de preço (ADR 0008). Sem `REDIS_URL`, um no-op: tudo é miss.
		 * Com ela, o cliente conecta em segundo plano — o boot não espera o Redis.
		 * Exportado para o health informar o estado.
		 */
		{
			provide: PriceCache,
			useFactory: (config: ConfigService<Env, true>): PriceCache => {
				const url = config.get("REDIS_URL", { infer: true });
				if (!url) {
					console.log(
						"💾 [CACHE] REDIS_URL not set — searching without the price cache.",
					);
					return new NoopPriceCache();
				}
				return createRedisPriceCache(
					url,
					config.get("PRICE_CACHE_TTL_SECONDS", { infer: true }),
				);
			},
			inject: [ConfigService],
		},

		/**
		 * O `PriceFetcher` que o motor recebe é o decorator com cache, que chama o
		 * AllKeyShop só para os misses. O `PriceGames` não sabe que o cache existe.
		 */
		{
			provide: PriceFetcher,
			useFactory: (source: CatalogPriceSource, cache: PriceCache) =>
				new CachedPriceFetcher(source, cache),
			inject: [CatalogPriceSource, PriceCache],
		},

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
					const { baseUrl, secret } = stockCredentials(config);
					return new HttpGameTradeImporter(baseUrl, secret);
				}),
			inject: [ConfigService],
		},

		/**
		 * A Trade com oferta (`POST /api/trades` do Estoque), também preguiçosa e
		 * pelas mesmas variáveis. Só o pedido com `currency` a usa.
		 */
		{
			provide: TradeWithOfferCreator,
			useFactory: (config: ConfigService<Env, true>) =>
				new LazyTradeWithOfferCreator(() => {
					const { baseUrl, secret } = stockCredentials(config);
					return new HttpTradeWithOfferCreator(baseUrl, secret);
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
			provide: ResearchGamesUseCase,
			useFactory: (priceGames: PriceGames) =>
				new ResearchGamesUseCase(priceGames),
			inject: [PriceGames],
		},
		{
			provide: CreateResearchTrade,
			useFactory: (
				priceGames: PriceGames,
				importer: GameTradeImporter,
				withOffer: TradeWithOfferCreator,
			) => new CreateResearchTrade(priceGames, importer, withOffer),
			inject: [PriceGames, GameTradeImporter, TradeWithOfferCreator],
		},

		/**
		 * A entrega do Resultado da pesquisa (ADR 0010). Com `QUEUE_REDIS_URL`, a
		 * fila durável `webhooks`, com novas tentativas por ~24h; sem ela, uma
		 * tentativa em memória.
		 *
		 * O segredo pode faltar só quando a allowlist está vazia (o schema do
		 * ambiente garante), e aí o envio recusa todo host antes de assinar —
		 * o `?? ""` nunca assina nada.
		 */
		{
			provide: ResearchResultNotifier,
			useFactory: (
				config: ConfigService<Env, true>,
			): ResearchResultNotifier => {
				const sender = new HttpWebhookSender(
					config.get("WEBHOOK_SIGNING_SECRET", { infer: true }) ?? "",
					config.get("WEBHOOK_ALLOWED_HOSTS", { infer: true }),
				);
				const url = config.get("QUEUE_REDIS_URL", { infer: true });
				return url
					? createBullmqWebhookQueue(url, sender)
					: new InMemoryWebhookNotifier(sender);
			},
			inject: [ConfigService],
		},

		{
			provide: ReadTopicGames,
			useFactory: (fetcherFactory: ListTopicFetcherFactory) =>
				new ReadTopicGames(fetcherFactory),
			inject: [ListTopicFetcherFactory],
		},

		/** O que a fila executa: raspagem, pesquisa, Trade e aviso a quem pediu. */
		{
			provide: RESEARCH_RUNNER,
			useFactory: (
				createTrade: CreateResearchTrade,
				notifier: ResearchResultNotifier,
				readTopicGames: ReadTopicGames,
			): ResearchGamesRunner =>
				new RunResearchJobUseCase(createTrade, notifier, readTopicGames),
			inject: [CreateResearchTrade, ResearchResultNotifier, ReadTopicGames],
		},

		/**
		 * A fila da pesquisa autenticada (ADR 0009). Com `QUEUE_REDIS_URL`, durável
		 * (BullMQ); sem ela — só fora de produção, o schema a exige em produção —
		 * a fila em memória de antes.
		 *
		 * Singleton (escopo default) **de propósito**: é estado compartilhado — a
		 * concorrência 1 só significa algo se todas as requisições passarem pela
		 * mesma instância, e com BullMQ uma segunda instância seria um segundo
		 * worker. Declarar este provider em dois módulos daria concorrência 2 sem
		 * ninguém perceber (`docs/nest-conceitos.md` §4).
		 *
		 * Concorrência fixa em 1, não configurável: o scraping do AllKeyShop já é
		 * serializado pelo browser compartilhado.
		 *
		 * O adapter BullMQ tem os hooks de ciclo de vida: começa a consumir no
		 * `onApplicationBootstrap` e para no `beforeApplicationShutdown`, antes de
		 * o `BrowserShutdown` fechar o Chromium.
		 */
		{
			provide: ResearchQueue,
			useFactory: (
				config: ConfigService<Env, true>,
				runner: ResearchGamesRunner,
			): ResearchQueue => {
				const url = config.get("QUEUE_REDIS_URL", { infer: true });
				if (!url) {
					console.log(
						"📥 [QUEUE] QUEUE_REDIS_URL not set — research queue in memory; a restart drops queued requests.",
					);
					return new InMemoryResearchQueue(
						new LimitedConcurrencyScheduler(1),
						runner,
					);
				}
				return createBullmqResearchQueue(url, runner);
			},
			inject: [ConfigService, RESEARCH_RUNNER],
		},
		{
			provide: EnqueueResearchGamesUseCase,
			useFactory: (
				queue: ResearchQueue,
				notifier: ResearchResultNotifier,
				config: ConfigService<Env, true>,
			) =>
				new EnqueueResearchGamesUseCase(
					queue,
					notifier,
					config.get("WEBHOOK_ALLOWED_HOSTS", { infer: true }),
				),
			inject: [ResearchQueue, ResearchResultNotifier, ConfigService],
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
	exports: [PriceGames, GameTradeImporter, PriceCache, ResearchQueue],
})
export class GamesModule {}
