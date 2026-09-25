import { Module } from "@nestjs/common";
import { SteamTradesBumper } from "@/application/bump/ports/steam-trades-bumper.port.js";
import { BumpTopicsUseCase } from "@/application/bump/use-cases/bump-topics.use-case.js";
import { createPuppeteerSteamTradesBumper } from "@/infrastructure/bump/puppeteer-steam-trades-bumper.js";
import { BumpScheduler } from "@/nest/bump/bump.scheduler.js";

/**
 * O bump dos anúncios do CarcaDeals.
 *
 * Não tem controller: nenhuma rota dispara isto. É trabalho de fundo puro, e é
 * por isso que o módulo existe separado — o `@Interval()` precisa de um provider
 * vivo para pendurar o timer.
 */
@Module({
	providers: [
		/**
		 * O bumper é **um só**, compartilhado pelo use case e pelo agendador.
		 *
		 * Ele mantém um browser persistente entre ticks — não abre e fecha
		 * Chromium a cada 5 minutos. Registrar dois providers criaria dois
		 * browsers, e o `OnApplicationShutdown` fecharia só um.
		 *
		 * A factory devolve `null` quando falta `STEAMTRADES_SESSION`; aqui isso
		 * vira um bumper que não faz nada, para o container conseguir subir. Quem
		 * decide não agendar é o `BumpScheduler`, que também loga o motivo.
		 */
		{
			provide: SteamTradesBumper,
			useFactory: (): SteamTradesBumper =>
				createPuppeteerSteamTradesBumper() ?? {
					bumpUserTopics: async () => [],
				},
		},
		{
			provide: BumpTopicsUseCase,
			useFactory: (bumper: SteamTradesBumper) => new BumpTopicsUseCase(bumper),
			inject: [SteamTradesBumper],
		},
		BumpScheduler,
	],
})
export class BumpModule {}
