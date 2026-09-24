import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { HealthController } from "@/nest/health/health.controller.js";

/**
 * A raiz do app Nest — o composition root que vai substituir `src/app.ts`.
 *
 * Por enquanto não serve nenhuma rota de negócio: os módulos `games`, `lists` e
 * `suppliers` entram nos PRs 3 a 6 (`docs/NEST.md` §5), e produção segue no
 * Express até o PR 9.
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
	imports: [AppConfigModule],
	controllers: [HealthController],
	providers: [
		{ provide: APP_FILTER, useClass: AllExceptionsFilter },
	],
})
export class AppModule {}
