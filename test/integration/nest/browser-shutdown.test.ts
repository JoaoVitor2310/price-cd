import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it, vi } from "vitest";
import { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { SuppliersBrowserSession } from "@/infrastructure/browser/suppliers-browser-session.js";
import { BrowserModule, BrowserShutdown } from "@/nest/browser/browser.module.js";

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

		const moduleRef = await Test.createTestingModule({ imports: [BrowserModule] })
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

	it("gives every consumer the SAME session instance", async () => {
		// A armadilha que custa memória: o mesmo provider declarado em dois
		// módulos vira duas instâncias — dois gerenciadores de Chromium num
		// container com mem_limit 2g.
		const a = await Test.createTestingModule({ imports: [BrowserModule] }).compile();
		const b = await Test.createTestingModule({ imports: [BrowserModule] }).compile();

		expect(a.get(SharedBrowserSession)).toBe(b.get(SharedBrowserSession));
		expect(a.get(SuppliersBrowserSession)).toBe(b.get(SuppliersBrowserSession));
		await a.close();
		await b.close();
	});
});
