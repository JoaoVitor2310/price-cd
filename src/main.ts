import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import path from "node:path";
import type { Env } from "@/config/env.schema.js";
import { AppModule } from "@/nest/app.module.js";

/**
 * Entrypoint do app Nest, irmão de `src/server.ts` (Express).
 *
 * Os dois coexistem durante a migração (`docs/NEST.md` §3): produção continua
 * no Express até o PR 9, e este sobe numa porta diferente (`PORT_NEST`) para que
 * ambos rodem em dev sem colidir. Nenhum agendador é iniciado aqui ainda — o
 * bump entra no PR 7, e dois processos agendando bump ao mesmo tempo seria
 * spam no SteamTrades.
 */
async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule);
	const config = app.get(ConfigService<Env, true>);

	// Paridade com src/app.ts: os arquivos estáticos e o prefixo /api das rotas.
	app.useStaticAssets(path.join(process.cwd(), "public"));
	app.setGlobalPrefix("api", { exclude: ["/"] });

	/**
	 * Liga os hooks de ciclo de vida do container ao SIGTERM/SIGINT do processo.
	 *
	 * É o que vai consertar, no PR 6, o bug de shutdown atual: hoje
	 * `startBumpTopicsScheduler` é o único handler de SIGTERM e chama
	 * `process.exit(0)`, matando o processo antes de `invalidateSharedSession()`
	 * e `cleanupSuppliersSession()` rodarem — Chromium órfão, que foi o que
	 * derrubou a VPS por OOM em 2026-08-24 (ver CLAUDE.md).
	 */
	app.enableShutdownHooks();

	const port = config.get("PORT_NEST", { infer: true });
	await app.listen(port);

	// Equivalente ao `server.setTimeout(SERVER_TIMEOUT_MS)` do server.ts —
	// scraping de uma lista grande passa fácil do default de 2min do Node.
	app.getHttpServer().setTimeout(config.get("SERVER_TIMEOUT_MS", { infer: true }));

	new Logger("Bootstrap").log(`Nest app ouvindo em http://localhost:${port}`);
}

void bootstrap();
