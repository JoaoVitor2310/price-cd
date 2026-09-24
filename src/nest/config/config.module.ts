import { Module } from "@nestjs/common";
import { ConfigModule as NestConfigModule } from "@nestjs/config";
import { validateEnv } from "@/config/env.schema.js";

/**
 * Wrapper do `ConfigModule` do Nest com a validação do projeto já ligada.
 *
 * `isGlobal: true` porque configuração é infraestrutura transversal: sem isso
 * todo módulo de feature precisaria importar `ConfigModule` explicitamente, e
 * esquecer um import viraria um `ConfigService` indisponível em runtime.
 *
 * `validate` roda **no boot**, uma vez. Variável malformada derruba o processo
 * com a lista completa de problemas, em vez de estourar no primeiro request —
 * que era o comportamento do Express (`Number(process.env.X) || default`
 * engolia `"abc"` silenciosamente como default).
 */
@Module({
	imports: [
		NestConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
	],
})
export class AppConfigModule {}
