import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { PriceFetcher } from "@/application/games/ports/game-search.ports.js";
import { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import {
	BrowserModule,
	BrowserShutdown,
} from "@/nest/browser/browser.module.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { GamesModule } from "@/nest/games/games.module.js";
import { SuppliersModule } from "@/nest/suppliers/suppliers.module.js";

/**
 * O desligamento ordenado do Chromium.
 *
 * O bug que isto substitui: `startBumpTopicsScheduler` era o único handler de
 * `SIGTERM` e chamava `process.exit(0)` — o processo morria antes de as sessões
 * do AllKeyShop e de fornecedores serem fechadas, e os Chromium delas ficavam
 * órfãos. Foi assim que a VPS caiu por OOM em 2026-08-24.
 */
describe("BrowserShutdown", () => {
	const build = async () => {
		const shared = { invalidate: vi.fn().mockResolvedValue(undefined) };
		const suppliers = { cleanup: vi.fn().mockResolvedValue(undefined) };

		const moduleRef = await Test.createTestingModule({
			imports: [BrowserModule],
		})
			.overrideProvider(SharedBrowserSession)
			.useValue(shared)
			.overrideProvider(SuppliersBrowserSession)
			.useValue(suppliers)
			.compile();

		return { moduleRef, shared, suppliers };
	};

	it("closes every browser session on shutdown", async () => {
		const { moduleRef, shared, suppliers } = await build();

		await moduleRef.get(BrowserShutdown).onApplicationShutdown("SIGTERM");

		expect(shared.invalidate).toHaveBeenCalledTimes(1);
		expect(suppliers.cleanup).toHaveBeenCalledTimes(1);
		await moduleRef.close();
	});

	it("still closes the second session when the first one fails", async () => {
		// Uma falha ao fechar um browser não pode deixar o outro órfão — é
		// exatamente o modo de falha que derrubou a VPS.
		const { moduleRef, shared, suppliers } = await build();
		shared.invalidate.mockRejectedValueOnce(new Error("close failed"));

		await expect(
			moduleRef.get(BrowserShutdown).onApplicationShutdown("SIGTERM"),
		).resolves.toBeUndefined();

		expect(suppliers.cleanup).toHaveBeenCalledTimes(1);
		await moduleRef.close();
	});

	it("runs when the container shuts down, not only when called directly", async () => {
		// Prova que o hook está ligado ao ciclo de vida: `app.close()` dispara.
		const { moduleRef, shared, suppliers } = await build();
		const app = moduleRef.createNestApplication();
		app.enableShutdownHooks();
		await app.init();

		await app.close();

		expect(shared.invalidate).toHaveBeenCalledTimes(1);
		expect(suppliers.cleanup).toHaveBeenCalledTimes(1);
	});

	it("injects the same session object into every adapter that needs it", async () => {
		// A armadilha que custa memória: o mesmo provider declarado em dois
		// módulos vira duas instâncias — dois gerenciadores de Chromium num
		// container com mem_limit 2g.
		//
		// A asserção é sobre o que os ADAPTERS receberam, não sobre o que
		// `moduleRef.get()` devolve. Duas versões anteriores deste teste passavam
		// sem provar nada: comparar duas árvores de módulo separadas só funcionava
		// por causa do singleton de módulo (andaime da coexistência com o
		// Express), e `get(token, { strict: false })` resolve da raiz do
		// container, devolvendo a MESMA instância mesmo quando um módulo declarou
		// a sua própria. Verificado por mutação: declarar `SharedBrowserSession`
		// em `GamesModule` passava verde nos dois casos.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule, SuppliersModule],
		}).compile();

		// A sessão é campo privado: é ela o observável, e não há getter — expor um
		// só para o teste seria pior que este cast.
		const sessionOf = (adapter: unknown) =>
			(adapter as { session: unknown }).session;

		expect(sessionOf(moduleRef.get(PriceFetcher))).toBe(
			moduleRef.get(SharedBrowserSession),
		);
		expect(sessionOf(moduleRef.get(TradePaginator))).toBe(
			moduleRef.get(SuppliersBrowserSession),
		);
		await moduleRef.close();
	});

	it("builds the shared session with the max age from the validated config", async () => {
		// A idade vinha de `Number(process.env.BROWSER_SESSION_MAX_AGE_MS)` lido à
		// mão no singleton — um parse duplicado, fora da validação de boot.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, BrowserModule],
		}).compile();

		const session = moduleRef.get(SharedBrowserSession);

		// Não há getter para a idade: o que dá para afirmar é que a fábrica
		// construiu a classe real, com a dependência resolvida, em vez de estourar.
		expect(session).toBeInstanceOf(SharedBrowserSession);
		await moduleRef.close();
	});
});
