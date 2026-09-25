import {
	Injectable,
	Logger,
	type OnApplicationBootstrap,
	type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { SteamTradesBumper } from "@/application/bump/ports/steam-trades-bumper.port.js";
import { BumpTopicsUseCase } from "@/application/bump/use-cases/bump-topics.use-case.js";
import type { Env } from "@/config/env.schema.js";
import { disposeIfPresent } from "@/lib/dispose.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Bumpa os anúncios do CarcaDeals no SteamTrades a cada 5 minutos.
 *
 * Substitui `startBumpTopicsScheduler`, que era uma função com `setInterval`,
 * estado em closure e — até o PR 6 — um handler de `SIGTERM` próprio que
 * chamava `process.exit(0)`. Aqui cada uma dessas coisas tem um lugar:
 *
 * | Antes | Agora |
 * |---|---|
 * | `setInterval` na função | `@Interval()` |
 * | `let running` em closure | campo da classe |
 * | `void run()` antes do timer | `OnApplicationBootstrap` |
 * | `process.once("SIGTERM")` | `OnApplicationShutdown` |
 *
 * `OnApplicationBootstrap` e **não** `OnModuleInit`: o primeiro tick abre um
 * Chromium e fala com o SteamTrades. `OnModuleInit` roda com o grafo ainda
 * subindo — se algo falhasse ali, o erro apareceria no meio da construção do
 * container, não num app já de pé.
 */
@Injectable()
export class BumpScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
	private readonly logger = new Logger(BumpScheduler.name);

	/**
	 * Impede que um tick comece com o anterior ainda rodando.
	 *
	 * Um bump leva minutos quando há muitos anúncios; sem isto, dois ticks
	 * disputariam o mesmo browser persistente.
	 */
	private running = false;

	/** Resolvido uma vez no bootstrap, como no Express. */
	private enabled = false;

	constructor(
		private readonly useCase: BumpTopicsUseCase,
		/** A mesma instância que o use case usa — é ela que é `Disposable`. */
		private readonly bumper: SteamTradesBumper,
		private readonly config: ConfigService<Env, true>,
	) {}

	/**
	 * Decide **uma vez** se o agendador vai rodar, e avisa uma vez se não.
	 *
	 * O Express decide no start: `startBumpTopicsScheduler` devolve `null` e loga
	 * o motivo. Decidir a cada tick faria o mesmo aviso sair de 5 em 5 minutos
	 * para sempre.
	 */
	onApplicationBootstrap(): void {
		this.enabled = this.resolveEnabled();
		if (!this.enabled) return;

		this.logger.log(
			`Bump scheduled — STEAM_ID: ${this.steamId()} (every 5 minutes)`,
		);

		// Sem `await` de propósito: um bump leva minutos com muitos anúncios, e
		// esperá-lo aqui seguraria o boot do app inteiro — a porta HTTP não
		// aceitaria requisição enquanto o Chromium raspasse o SteamTrades. O
		// agendador antigo também disparava sem esperar (`void run()`).
		void this.tick();
	}

	@Interval(INTERVAL_MS)
	async onInterval(): Promise<void> {
		if (!this.enabled) return;
		await this.tick();
	}

	/** Fecha o browser persistente. Quem encerra o processo é o entrypoint. */
	async onApplicationShutdown(): Promise<void> {
		if (!this.enabled) return;

		this.logger.log("Closing the bump browser…");
		await disposeIfPresent(this.bumper);
	}

	/**
	 * Três condições, e **todas** existiam no Express: o interruptor, `STEAM_ID`
	 * e a sessão do SteamTrades.
	 *
	 * A sessão precisa ser checada aqui porque
	 * `createPuppeteerSteamTradesBumper()` devolve `null` sem ela, e o provider
	 * cai num bumper mudo para o container conseguir subir. Sem esta checagem o
	 * agendador ticaria de 5 em 5 minutos bumpando **nada**, em silêncio — o
	 * mesmo modo de falha que `BUMP_SCHEDULER_ENABLED` existe para evitar.
	 */
	private resolveEnabled(): boolean {
		if (!this.config.get("BUMP_SCHEDULER_ENABLED", { infer: true })) {
			this.logger.log("Bump scheduler disabled by BUMP_SCHEDULER_ENABLED.");
			return false;
		}

		const missing = (["STEAM_ID", "STEAMTRADES_SESSION"] as const).filter(
			(key) => !this.config.get(key, { infer: true })?.trim(),
		);

		if (missing.length > 0) {
			this.logger.warn(`Bump not scheduled — set ${missing.join(" and ")} in .env.`);
			return false;
		}
		return true;
	}

	private steamId(): string | undefined {
		return this.config.get("STEAM_ID", { infer: true })?.trim() || undefined;
	}


	private async tick(): Promise<void> {
		if (this.running) {
			this.logger.log("Tick skipped — the previous run is still going.");
			return;
		}

		const steamId = this.steamId();
		if (!steamId) return;

		this.running = true;
		try {
			const { bumped, cooldown, failed } = await this.useCase.execute({ steamId });

			if (bumped.length > 0) this.logger.log(`Bumped: ${bumped.join(", ")}`);
			if (cooldown.length > 0) this.logger.log(`Cooldown: ${cooldown.join(", ")}`);
			if (failed.length > 0) this.logger.error(`Failed: ${failed.join(", ")}`);
		} catch (error) {
			this.logger.error("Unexpected error in the bump scheduler", error as Error);
		} finally {
			this.running = false;
		}
	}
}
