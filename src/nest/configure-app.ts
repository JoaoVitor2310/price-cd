import path from "node:path";
import type { NestExpressApplication } from "@nestjs/platform-express";

/**
 * Configuração de bootstrap compartilhada entre `src/main.ts` e os testes.
 *
 * Existe porque um portão que monta a própria configuração não é portão: se o
 * `setGlobalPrefix` sumisse do `main.ts`, a bateria de contrato continuaria
 * verde — ela teria aplicado o prefixo por conta própria — e a quebra só
 * apareceria em produção, no cutover.
 *
 * Fica de fora daqui só o que é exclusivo do processo real: `listen`,
 * `enableShutdownHooks` e o timeout do servidor HTTP.
 */
export function configureNestApp(app: NestExpressApplication): void {
	// Paridade com `src/app.ts`: o estático é registrado ANTES das rotas, e é o
	// que faz `GET /` servir `public/index.html` em vez do handler de autoria.
	app.useStaticAssets(path.join(process.cwd(), "public"));
	app.setGlobalPrefix("api", { exclude: ["/"] });
}
