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
			/**
			 * **Não** deixe o Nest ler o `.env`.
			 *
			 * Com o carregamento dele ligado, o valor do ARQUIVO vence o que já
			 * está em `process.env` — medido: com `INTERNAL_SECRET=x` exportado e
			 * `INTERNAL_SECRET=y` no `.env`, o `ConfigService` devolve `y`.
			 *
			 * Isso inverte a precedência que o resto do sistema assume. No
			 * `docker-compose.yml` o bloco `environment:` existe justamente para
			 * mandar mais que o `env_file:` — com o `.env` vencendo, um arquivo
			 * esquecido dentro da imagem passaria por cima da configuração do
			 * deploy, em silêncio.
			 *
			 * O `.env` continua valendo em dev: quem o carrega é o `dotenv.config()`
			 * do `src/main.ts`, que **não** sobrescreve variável já definida — a
			 * precedência correta, e a mesma que o Express já usa via `src/app.ts`.
			 */
			ignoreEnvFile: true,
		}),
	],
})
export class AppConfigModule {}
