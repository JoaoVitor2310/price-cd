import {
	Injectable,
	Module,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import { sharedBrowserSession, suppliersBrowserSession } from "@/infrastructure/browser/sessions.js";

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
				this.logger.error(`Failed to close the ${name} browser`, error as Error);
			}
		}
	}
}

/**
 * O dono das sessões de Chromium do processo.
 *
 * ⚠️ **As instâncias entram com `useValue`, não `useClass`.** Durante a
 * coexistência Express/Nest as duas apresentações chegam às mesmas instâncias
 * de `infrastructure/browser/sessions.ts`; se o container criasse as suas próprias
 * instâncias, existiriam **dois** gerenciadores de Chromium num container com
 * `mem_limit: 2g`. `useValue` amarra o container à mesma instância que as
 * fachadas usam.
 *
 * Pela mesma razão, quem precisar destas sessões faz `imports: [BrowserModule]`
 * — declarar os providers de novo em outro módulo criaria instâncias separadas
 * (`docs/nest-conceitos.md` §4).
 *
 * No PR 10, com o Express fora, isto pode virar `useClass` e o singleton de
 * módulo desaparece.
 */
@Module({
	providers: [
		{ provide: SharedBrowserSession, useValue: sharedBrowserSession },
		{ provide: SuppliersBrowserSession, useValue: suppliersBrowserSession },
		BrowserShutdown,
	],
	exports: [SharedBrowserSession, SuppliersBrowserSession],
})
export class BrowserModule {}
