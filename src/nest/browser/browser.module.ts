import {
	Injectable,
	Logger,
	Module,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/env.schema.js";
import { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";

/** Reciclagem preventiva a cada 30 min; `0` desliga (ver `.env.example`). */
const DEFAULT_SESSION_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Fecha todo Chromium quando o app desliga.
 *
 * Substitui os handlers manuais de `SIGTERM`/`SIGINT` que viviam dentro do
 * agendador de bump e chamavam `process.exit(0)` — matando o processo antes de
 * as sessões do AllKeyShop e de fornecedores serem fechadas. Os Chromium delas
 * ficavam órfãos; foi assim que a VPS caiu por OOM em 2026-08-24.
 *
 * `OnApplicationShutdown` só dispara porque `src/main.ts` chama
 * `app.enableShutdownHooks()`. Sem isso o Nest não escuta sinal nenhum, e este
 * arquivo seria decoração.
 *
 * Cada sessão é fechada isoladamente: falhar em uma não pode impedir a outra.
 */
@Injectable()
export class BrowserShutdown implements OnApplicationShutdown {
	private readonly logger = new Logger(BrowserShutdown.name);

	constructor(
		private readonly shared: SharedBrowserSession,
		private readonly suppliers: SuppliersBrowserSession,
	) {}

	async onApplicationShutdown(signal?: string): Promise<void> {
		this.logger.log(`${signal ?? "shutdown"} received — closing browsers…`);

		for (const [name, close] of [
			["allkeyshop", () => this.shared.invalidate()],
			["suppliers", () => this.suppliers.cleanup()],
		] as const) {
			try {
				await close();
			} catch (error) {
				this.logger.error(
					`Failed to close the ${name} browser`,
					error as Error,
				);
			}
		}
	}
}

/**
 * O dono das sessões de Chromium do processo.
 *
 * ⚠️ **Exatamente um módulo declara estes providers, e é este.** O container
 * garante uma instância por token — mas só por token **dentro do módulo que o
 * declara**. Declarar `SharedBrowserSession` de novo em outro módulo criaria uma
 * segunda instância, e cada instância é um gerenciador de Chromium num container
 * com `mem_limit: 2g`. Quem precisa de uma sessão faz `imports: [BrowserModule]`
 * (`docs/nest-conceitos.md` §4).
 *
 * Enquanto o Express coexistia, as instâncias vinham de um singleton de módulo
 * (`infrastructure/browser/sessions.ts`) e entravam aqui com `useValue`: era o
 * único jeito de as duas apresentações chegarem ao mesmo objeto. Com um app só,
 * o container é o dono e aquele arquivo deixou de existir.
 *
 * `SuppliersBrowserSession` não tem dependência, então `useClass` basta.
 * `SharedBrowserSession` precisa da idade máxima de reciclagem, e ela vem do
 * `ConfigService` — antes era `Number(process.env.BROWSER_SESSION_MAX_AGE_MS)`
 * lido à mão no singleton, duplicando um parse que o schema do ambiente já faz e
 * escapando da validação de boot.
 *
 * A idade continua sendo uma **função**, não um número: `SharedBrowserSession` a
 * chama a cada `get()`, e é isso que permite testar reciclagem sem reconstruir o
 * objeto.
 */
@Module({
	providers: [
		{
			provide: SharedBrowserSession,
			useFactory: (config: ConfigService<Env, true>) =>
				new SharedBrowserSession(
					() =>
						config.get("BROWSER_SESSION_MAX_AGE_MS", { infer: true }) ??
						DEFAULT_SESSION_MAX_AGE_MS,
				),
			inject: [ConfigService],
		},
		{ provide: SuppliersBrowserSession, useClass: SuppliersBrowserSession },
		BrowserShutdown,
	],
	exports: [SharedBrowserSession, SuppliersBrowserSession],
})
export class BrowserModule {}
