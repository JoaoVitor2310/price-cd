import { Module } from "@nestjs/common";
import { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import { fetchListTopic } from "@/infrastructure/lists/fetch-list-topic.js";
import { TrackedListTopicFetcherFactory } from "@/infrastructure/lists/tracked-list-topic-fetcher-factory.js";

/**
 * Quem lê tópicos do SteamTrades. Módulo próprio pelo mesmo motivo do
 * `BrowserModule`: `ListsModule` e `GamesModule` precisam da fábrica, e
 * `ListsModule` já importa `GamesModule`. Declarada em um dos dois, a dependência
 * ficaria invertida ou circular; declarada nos dois, seriam duas donas.
 *
 * Fábrica, não instância: cada execução é dona de uma sessão de browser e a
 * descarta no `finally`. Um singleton faria execuções concorrentes compartilharem
 * a mesma sessão.
 */
@Module({
	providers: [
		{
			provide: ListTopicFetcherFactory,
			useFactory: () => new TrackedListTopicFetcherFactory(fetchListTopic),
		},
	],
	exports: [ListTopicFetcherFactory],
})
export class ListTopicModule {}
