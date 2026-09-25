import { BumpTopicsUseCase } from "@/application/bump/use-cases/bump-topics.use-case.js";
import { disposeIfPresent } from "@/lib/dispose.js";
import { createPuppeteerSteamTradesBumper } from "@/infrastructure/bump/puppeteer-steam-trades-bumper.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Inicia o agendador de bump dos tópicos do SteamTrades.
 * - Executa imediatamente ao subir e depois a cada 5 minutos.
 * - Pula o tick se a execução anterior ainda estiver em andamento.
 * - O bumper mantém um browser persistente — não abre/fecha Chrome a cada tick.
 * - Devolve uma função de desligamento. NÃO registra handler de sinal: quem
 *   conhece o processo inteiro é o entrypoint (`src/server.ts` no Express,
 *   `OnApplicationShutdown` no Nest). Registrar aqui foi a causa do bug de
 *   shutdown descrito abaixo.
 * - Se STEAMTRADES_SESSION ou STEAM_ID não estiverem definidos, não inicia.
 */
export function startBumpTopicsScheduler(): (() => Promise<void>) | null {
	const steamId = process.env.STEAM_ID?.trim();
	const bumper = createPuppeteerSteamTradesBumper();

	if (!bumper || !steamId) {
		console.warn(
			"⚠️ [BUMP] Scheduler não iniciado — defina STEAMTRADES_SESSION e STEAM_ID no .env.",
		);
		return null;
	}

	const useCase = new BumpTopicsUseCase(bumper);
	let running = false;

	const run = async () => {
		if (running) {
			console.log("⏭️ [BUMP] Tick ignorado — execução anterior ainda em andamento.");
			return;
		}

		running = true;
		try {
			const result = await useCase.execute({ steamId });

			if (result.bumped.length > 0) {
				console.log(`✅ [BUMP] Bumped: ${result.bumped.join(", ")}`);
			}
			if (result.cooldown.length > 0) {
				console.log(`⏳ [BUMP] Cooldown: ${result.cooldown.join(", ")}`);
			}
			if (result.failed.length > 0) {
				console.error(`❌ [BUMP] Failed: ${result.failed.join(", ")}`);
			}
		} catch (err) {
			console.error("❌ [BUMP] Erro inesperado no scheduler:", err);
		} finally {
			running = false;
		}
	};

	void run();
	const timer = setInterval(() => void run(), INTERVAL_MS);

	console.log(`🚀 [BUMP] Scheduler iniciado — STEAM_ID: ${steamId} (intervalo: 5min)`);

	/**
	 * Encerra o browser persistente do bump.
	 *
	 * **Não chama `process.exit()`.** A versão anterior chamava, e era o bug: o
	 * processo morria aqui, antes de a sessão do AllKeyShop
	 * (`invalidateSharedSession`) e a de fornecedores (`cleanupSuppliersSession`)
	 * serem fechadas. Os Chromium delas ficavam órfãos — o modo de falha que
	 * derrubou a VPS por OOM em 2026-08-24.
	 *
	 * Agora quem decide quando o processo termina é o entrypoint, depois de
	 * desligar tudo.
	 */
	return async () => {
		console.log("🛑 [BUMP] Encerrando browser persistente...");
		clearInterval(timer);
		await disposeIfPresent(bumper);
	};
}
