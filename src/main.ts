import "reflect-metadata";
/**
 * Carrega o `.env` ANTES de qualquer outro import, e é por isso que é um import
 * de efeito colateral em vez do `dotenv.config()` que estava no corpo da função.
 *
 * Import de ESM é hoisted: todo o grafo é avaliado antes da primeira linha
 * deste arquivo rodar. Como `AppConfigModule` valida o ambiente no momento em
 * que é importado (ver o docblock de `src/nest/config/config.module.ts`), um
 * `dotenv.config()` mais abaixo chegava tarde — e toda variável com default no
 * schema (`PORT`, `SERVER_TIMEOUT_MS`, `BUMP_SCHEDULER_ENABLED`, …) ficava
 * congelada no default, ignorando o `.env` em silêncio.
 *
 * Em Docker não aparecia: lá as variáveis vêm do `env_file`/`environment` do
 * compose, já no ambiente do processo antes do Node subir. Aparecia em
 * `npm start` local, e `BUMP_SCHEDULER_ENABLED=false` no `.env` não desligava
 * nada — o interruptor que existe para evitar ban de conta.
 *
 * `dotenv/config` não sobrescreve variável já definida, então a precedência
 * continua: ambiente real > `.env` > default do schema.
 */
import "dotenv/config";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Env } from "@/config/env.schema.js";
import { AppModule } from "@/nest/app.module.js";
import { configureNestApp } from "@/nest/configure-app.js";

/**
 * Entrypoint único do processo.
 *
 * Até a remoção do Express havia um irmão (`src/server.ts`) e uma porta
 * separada (`PORT_NEST`) para os dois rodarem em dev sem colidir. Sobrou um
 * app, então sobrou uma porta: `PORT`.
 */
async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	const config = app.get(ConfigService<Env, true>);

	configureNestApp(app);

	/**
	 * Liga os hooks de ciclo de vida do container ao SIGTERM/SIGINT do processo.
	 *
	 * Sem isto o `OnApplicationShutdown` do `BrowserShutdown` nunca dispararia, e
	 * as sessões de Chromium ficariam órfãs no desligamento — o modo de falha que
	 * derrubou a VPS por OOM em 2026-08-24 (ver CLAUDE.md).
	 */
	app.enableShutdownHooks();

	const port = config.get("PORT", { infer: true });
	await app.listen(port);

	new Logger("Bootstrap").log(`App ouvindo em http://localhost:${port}`);
}

void bootstrap();
