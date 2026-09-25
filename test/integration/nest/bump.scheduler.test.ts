import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SteamTradesBumper } from "@/application/bump/ports/steam-trades-bumper.port.js";
import { BumpTopicsUseCase } from "@/application/bump/use-cases/bump-topics.use-case.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { BumpModule } from "@/nest/bump/bump.module.js";
import { BumpScheduler } from "@/nest/bump/bump.scheduler.js";

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("BumpScheduler", () => {
	let close: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await close?.();
		close = undefined;
	});

	/** Monta o módulo real com um bumper de mentira e config controlada. */
	const build = async (config: Record<string, unknown>) => {
		const bumper = { bumpUserTopics: vi.fn().mockResolvedValue([]), dispose: vi.fn() };

		// `AppConfigModule` entra no grafo porque `BumpScheduler` depende do
		// `ConfigService`: `isGlobal` dispensa o import em produção, mas não faz
		// o provider existir num grafo de teste que não o inclua.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, BumpModule],
		})
			.overrideProvider(SteamTradesBumper)
			.useValue(bumper)
			.overrideProvider(ConfigService)
			.useValue({ get: (key: string) => config[key] })
			.compile();

		close = () => moduleRef.close();
		return { scheduler: moduleRef.get(BumpScheduler), bumper, moduleRef };
	};

	const enabled = {
		BUMP_SCHEDULER_ENABLED: true,
		STEAM_ID: "76561198000000000",
		STEAMTRADES_SESSION: "session-cookie",
	};

	it("bumps on boot without blocking it", async () => {
		// Esperar o primeiro tick seguraria o boot do app: um bump leva minutos
		// com muitos anúncios, e a porta HTTP não aceitaria requisição até lá.
		const { scheduler, bumper } = await build(enabled);
		let slowResolved = false;
		bumper.bumpUserTopics.mockImplementation(
			() => new Promise((r) => setTimeout(() => { slowResolved = true; r([]); }, 50)),
		);

		scheduler.onApplicationBootstrap();

		expect(slowResolved).toBe(false);
		await new Promise((r) => setTimeout(r, 60));
		expect(bumper.bumpUserTopics).toHaveBeenCalledTimes(1);
	});

	it("skips a tick while the previous one is still running", async () => {
		// Dois ticks concorrentes disputariam o mesmo browser persistente.
		const { scheduler, bumper } = await build(enabled);
		let release: (value: unknown) => void = () => {};
		bumper.bumpUserTopics.mockReturnValue(new Promise((r) => { release = r; }));

		scheduler.onApplicationBootstrap();
		await settled();
		void scheduler.onInterval();
		await settled();
		void scheduler.onInterval();
		await settled();

		expect(bumper.bumpUserTopics).toHaveBeenCalledTimes(1);
		release([]);
	});

	it("accepts a new tick once the previous one finished", async () => {
		const { scheduler, bumper } = await build(enabled);
		scheduler.onApplicationBootstrap();
		await settled();
		bumper.bumpUserTopics.mockClear();

		await scheduler.onInterval();
		await scheduler.onInterval();

		expect(bumper.bumpUserTopics).toHaveBeenCalledTimes(2);
	});

	it("releases the guard even when a tick throws", async () => {
		// Sem o `finally`, um erro travaria o agendador para sempre.
		const { scheduler, bumper } = await build(enabled);
		scheduler.onApplicationBootstrap();
		await settled();
		bumper.bumpUserTopics.mockClear();
		bumper.bumpUserTopics.mockRejectedValueOnce(new Error("steamtrades down"));

		await scheduler.onInterval();
		await scheduler.onInterval();

		expect(bumper.bumpUserTopics).toHaveBeenCalledTimes(2);
	});

	describe("the switch that prevents a double bump", () => {
		it("does not bump when BUMP_SCHEDULER_ENABLED is off", async () => {
			// Enquanto Express e Nest coexistem, os dois agendariam bump com a
			// MESMA conta do SteamTrades — dois processos comentando, caminho
			// conhecido para ban. Não é desempenho, é risco de negócio.
			const { scheduler, bumper } = await build({
				...enabled,
				BUMP_SCHEDULER_ENABLED: false,
			});

			scheduler.onApplicationBootstrap();
			await scheduler.onInterval();
			await settled();

			expect(bumper.bumpUserTopics).not.toHaveBeenCalled();
		});

		it.each([
			["STEAM_ID", { ...enabled, STEAM_ID: undefined }],
			["STEAMTRADES_SESSION", { ...enabled, STEAMTRADES_SESSION: undefined }],
		])("does not schedule anything without %s", async (_key, config) => {
			// Sem a sessão, `createPuppeteerSteamTradesBumper()` devolve `null` e o
			// provider cai num bumper mudo. Sem esta checagem o agendador ticaria
			// de 5 em 5 minutos bumpando NADA, em silêncio — e o Express, no mesmo
			// cenário, não agenda e avisa.
			const { scheduler, bumper } = await build(config);

			scheduler.onApplicationBootstrap();
			await scheduler.onInterval();
			await settled();

			expect(bumper.bumpUserTopics).not.toHaveBeenCalled();
		});
	});

	it("shares one bumper between the use case and the scheduler", async () => {
		// O bumper mantém um browser persistente entre ticks. Dois providers
		// seriam dois Chromium, e o shutdown fecharia só um.
		const { moduleRef, bumper } = await build(enabled);

		expect(moduleRef.get(SteamTradesBumper)).toBe(bumper);
		expect(moduleRef.get(BumpTopicsUseCase)).toBeInstanceOf(BumpTopicsUseCase);
	});

	it("disposes the persistent browser on shutdown", async () => {
		const { scheduler, bumper } = await build(enabled);
		scheduler.onApplicationBootstrap();
		await settled();

		await scheduler.onApplicationShutdown();

		expect(bumper.dispose).toHaveBeenCalledTimes(1);
	});
});
