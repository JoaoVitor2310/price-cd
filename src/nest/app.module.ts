import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { ScheduleModule } from "@nestjs/schedule";
import { BumpModule } from "@/nest/bump/bump.module.js";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { GamesModule } from "@/nest/games/games.module.js";
import { HealthController } from "@/nest/health/health.controller.js";
import { ListsModule } from "@/nest/lists/lists.module.js";
import { SuppliersModule } from "@/nest/suppliers/suppliers.module.js";

/**
 * A raiz do app — o composition root do processo inteiro.
 *
 * Serve `games`, `lists` e `suppliers`, mais o agendador de bump.
 *
 * O filter é registrado como provider via `APP_FILTER`, não com
 * `app.useGlobalFilters()`. A diferença importa: registrado assim ele participa
 * do container e pode injetar dependências (um `AlertNotifier`, por exemplo —
 * item 4 do `docs/IMPROVEMENTS.md`). Registrado pelo `app.use*` ele é só uma
 * instância solta, fora do alcance da DI. Ver `docs/nest-conceitos.md` §6.
 *
 * Não há `APP_PIPE` aqui de propósito. O plano previa um, mas o
 * `ZodValidationPipe` recebe o schema no construtor — cada rota valida contra um
 * schema diferente, então ele é aplicado por parâmetro
 * (`@Body(new ZodValidationPipe(gameSearchSchema))`), não globalmente. Um pipe
 * global só faria sentido se houvesse uma validação válida para toda rota, o que
 * não é o caso.
 */
@Module({
	imports: [
		AppConfigModule,
		// Habilita `@Interval()`. Sem isto o decorator não faz nada — e não
		// avisa: o método simplesmente nunca é chamado.
		ScheduleModule.forRoot(),
		BumpModule,
		GamesModule,
		ListsModule,
		SuppliersModule,
	],
	controllers: [HealthController],
	providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
