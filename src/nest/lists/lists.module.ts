import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PriceGames } from "@/application/games/services/price-games.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import type { SearchGamesRequest } from "@/application/games/game.types.js";
import {
	GameSearcher,
	ListTopicFetcherFactory,
	type RunListsRunner,
} from "@/application/lists/ports/list-run.ports.js";
import { EnqueueRunListsUseCase } from "@/application/lists/use-cases/enqueue-run-lists.use-case.js";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import type { Env } from "@/config/env.schema.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { GamesModule } from "@/nest/games/games.module.js";
import { ListsController } from "@/nest/lists/lists.controller.js";
import {
	LISTS_RUNNER,
	LISTS_SCHEDULER,
	MAX_ACTIVE_LISTS,
} from "@/nest/lists/lists.tokens.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

/**
 * O wiring do Reabastecimento.
 *
 * `imports: [GamesModule]` porque `lists` precisa do motor de precificação
 * (`PriceGames`) e do importer de Trade, que são exportados de lá. **Importar o
 * módulo é o jeito certo; redeclarar os providers aqui seria o erro** — o mesmo
 * provider declarado em dois módulos vira duas instâncias, e neste projeto isso
 * significaria dois gerenciadores de browser no mesmo container
 * (`docs/nest-conceitos.md` §4).
 */
@Module({
	imports: [GamesModule],
	controllers: [ListsController],
	providers: [
		/**
		 * Fábrica, não instância: cada execução é dona de uma sessão de browser e
		 * a descarta no `finally`. Um singleton faria execuções concorrentes
		 * compartilharem a mesma sessão.
		 */
		{
			provide: ListTopicFetcherFactory,
			useValue: { create: () => fetchListTopic() } satisfies ListTopicFetcherFactory,
		},

		/** A ponte entre subdomínios: `lists` pede preço, `games` sabe precificar. */
		{
			provide: GameSearcher,
			useFactory: (priceGames: PriceGames): GameSearcher => ({
				search: async (request: SearchGamesRequest) =>
					(await priceGames.run(request)).priced,
			}),
			inject: [PriceGames],
		},

		/**
		 * `MAX_ACTIVE_LISTS` sai de dentro do use case.
		 *
		 * Era `Number(process.env.MAX_ACTIVE_LISTS) || 3` lido dentro de
		 * `RunListsUseCase` — violação de camada. Agora vem do `ConfigService`,
		 * já validado no boot.
		 */
		{
			provide: MAX_ACTIVE_LISTS,
			useFactory: (config: ConfigService<Env, true>) =>
				config.get("MAX_ACTIVE_LISTS", { infer: true }),
			inject: [ConfigService],
		},

		/**
		 * A fila do reabastecimento — **separada** da fila da pesquisa manual.
		 * Concorrência vem do ambiente; a da pesquisa é 1 fixo. Ver
		 * `lists.tokens.ts` para o porquê de não compartilharem token.
		 */
		{
			provide: LISTS_SCHEDULER,
			useFactory: (config: ConfigService<Env, true>) =>
				new LimitedConcurrencyScheduler(
					config.get("RUN_LISTS_CONCURRENCY", { infer: true }),
				),
			inject: [ConfigService],
		},

		{
			provide: RunListsUseCase,
			useFactory: (
				fetcherFactory: ListTopicFetcherFactory,
				gameSearcher: GameSearcher,
				tradeImporter: GameTradeImporter,
				maxActiveLists: number,
			) =>
				new RunListsUseCase(
					fetcherFactory,
					gameSearcher,
					tradeImporter,
					maxActiveLists,
				),
			inject: [
				ListTopicFetcherFactory,
				GameSearcher,
				GameTradeImporter,
				MAX_ACTIVE_LISTS,
			],
		},

		/** Só composição: traduz "rodar o reabastecimento" para a fila. */
		{
			provide: LISTS_RUNNER,
			useFactory: (useCase: RunListsUseCase): RunListsRunner => ({
				run: async (request: SupplierListRequest) =>
					useCase.execute({
						supplierListRequest: request,
						checkGamivoOffer: request.checkGamivoOffer,
					}),
			}),
			inject: [RunListsUseCase],
		},
		{
			provide: EnqueueRunListsUseCase,
			useFactory: (scheduler: BackgroundScheduler, runner: RunListsRunner) =>
				new EnqueueRunListsUseCase(scheduler, runner),
			inject: [LISTS_SCHEDULER, LISTS_RUNNER],
		},
	],
})
export class ListsModule {}
