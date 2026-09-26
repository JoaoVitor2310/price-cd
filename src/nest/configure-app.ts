import path from "node:path";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Env } from "@/config/env.schema.js";

/**
 * Configuração de bootstrap compartilhada entre `src/main.ts` e os testes.
 *
 * Existe porque um portão que monta a própria configuração não é portão: se o
 * `setGlobalPrefix` sumisse do `main.ts`, a bateria de contrato continuaria
 * verde — ela teria aplicado o prefixo por conta própria — e a quebra só
 * apareceria em produção, no cutover.
 *
 * Pela mesma razão **não há parâmetros**. Uma primeira versão recebia o timeout
 * como argumento opcional, e nenhum teste o passava: o ramo que o aplica nunca
 * rodava na suíte, recriando exatamente o buraco que esta função fecha. Tudo
 * que ela precisa vem do container.
 *
 * Fica de fora daqui só o que é exclusivo do processo real: `listen` e
 * `enableShutdownHooks`.
 */
export function configureNestApp(app: NestExpressApplication): void {
	// Paridade com `src/app.ts`: o estático é registrado ANTES das rotas, e é o
	// que faz `GET /` servir `public/index.html` em vez do handler de autoria.
	app.useStaticAssets(path.join(process.cwd(), "public"));
	app.setGlobalPrefix("api", { exclude: ["/"] });

	// Equivalente ao `server.setTimeout()` do `server.ts`: scraping de uma lista
	// grande passa fácil do default de 2 minutos do Node.
	const config = app.get<ConfigService<Env, true>>(ConfigService);
	app
		.getHttpServer()
		.setTimeout(config.get("SERVER_TIMEOUT_MS", { infer: true }));
}
