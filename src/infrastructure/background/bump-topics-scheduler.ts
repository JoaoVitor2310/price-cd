import { BumpTopicsUseCase } from "@/application/bump/bump-topics.use-case.js";
import { disposeIfPresent } from "@/lib/dispose.js";
import { createPuppeteerSteamTradesBumper } from "@/infrastructure/bump/puppeteer-steam-trades-bumper.js";

const INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Inicia o agendador de bump dos tópicos do SteamTrades.
 * - Executa imediatamente ao subir e depois a cada 5 minutos.
 * - Pula o tick se a execução anterior ainda estiver em andamento.
 * - O bumper mantém um browser persistente — não abre/fecha Chrome a cada tick.
 * - Ao receber SIGTERM ou SIGINT, encerra o browser limpo via dispose().
 * - Se STEAMTRADES_SESSION ou STEAM_ID não estiverem definidos, não inicia.
 */
export function startBumpTopicsScheduler(): void {
	const steamId = process.env.STEAM_ID?.trim();
	const bumper = createPuppeteerSteamTradesBumper();

	if (!bumper || !steamId) {
		console.warn(
			"⚠️ [BUMP] Scheduler não iniciado — defina STEAMTRADES_SESSION e STEAM_ID no .env.",
		);
		return;
	}

	const useCase = new BumpTopicsUseCase();
	let running = false;

	const run = async () => {
		if (running) {
			console.log("⏭️ [BUMP] Tick ignorado — execução anterior ainda em andamento.");
			return;
		}

		running = true;
		try {
			const result = await useCase.execute({ steamId, bumper });

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

	// Encerra o browser persistente ao desligar o processo
	const shutdown = async () => {
		console.log("🛑 [BUMP] Encerrando browser persistente...");
		await disposeIfPresent(bumper);
		process.exit(0);
	};

	process.once("SIGTERM", () => void shutdown());
	process.once("SIGINT", () => void shutdown());

	void run();
	setInterval(() => void run(), INTERVAL_MS);

	console.log(`🚀 [BUMP] Scheduler iniciado — STEAM_ID: ${steamId} (intervalo: 5min)`);
}
