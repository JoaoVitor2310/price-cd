import app from "@/app.js";
import { startBumpTopicsScheduler } from "@/infrastructure/background/bump-topics-scheduler.js";
import {
	cleanupSuppliersSession,
	invalidateSharedSession,
} from "@/infrastructure/browser/sessions.js";

const PORT = process.env.PORT || 5555;
const SERVER_TIMEOUT_MS = Number(process.env.SERVER_TIMEOUT_MS) || 10 * 60 * 1000; // 10 min

/** Teto para o desligamento inteiro. Passou disso, sai de qualquer forma. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

// Fora do callback do `listen`: um SIGTERM que chegasse antes de a porta subir
// deixaria o browser do bump sem ninguém para fechá-lo.
const stopBumpScheduler = startBumpTopicsScheduler();

const server = app.listen(PORT, () => {
	console.log(`Price-researcher rodando em: http://localhost:${PORT}`);
});

server.setTimeout(SERVER_TIMEOUT_MS);

let shuttingDown = false;

/**
 * Desligamento ordenado — o único handler de sinal do processo.
 *
 * Existem **três** donos de Chromium: o browser persistente do bump, a sessão
 * compartilhada do AllKeyShop e a da Descoberta de Fornecedores. Antes só o
 * primeiro era encerrado, e ainda com `process.exit(0)` dentro do próprio
 * agendador — o processo morria antes dos outros dois, e os Chromium deles
 * ficavam órfãos. Foi assim que a VPS caiu por OOM em 2026-08-24.
 *
 * ## A ordem importa
 *
 * **Primeiro parar de aceitar requisição, depois fechar os browsers.** Ao
 * contrário, uma requisição que chegasse durante o teardown chamaria
 * `getSharedSession()` e abriria um Chromium **depois** do `invalidate()` —
 * recriando exatamente o vazamento que este código existe para evitar.
 *
 * `closeAllConnections()` é necessário porque `server.close()` só chama o
 * callback quando toda conexão morre, e com keep-alive isso pode levar os 10
 * minutos do `SERVER_TIMEOUT_MS`.
 *
 * Cada passo é isolado: falhar em fechar um browser não pode impedir os outros.
 */
const shutdown = async (signal: string): Promise<void> => {
	if (shuttingDown) return;
	shuttingDown = true;

	console.log(`🛑 [SHUTDOWN] ${signal} recebido — encerrando…`);

	// Rede de segurança: se algum cleanup pendurar, o processo ainda sai. Sem
	// isto o Docker esperaria o `docker stop` estourar e mandaria SIGKILL, que
	// mata o Node antes de ele fechar os browsers — o vazamento de novo.
	const giveUp = setTimeout(() => {
		console.error("❌ [SHUTDOWN] Tempo esgotado — saindo à força.");
		process.exit(1);
	}, SHUTDOWN_TIMEOUT_MS);
	giveUp.unref();

	await new Promise<void>((resolve) => {
		server.close(() => resolve());
		server.closeAllConnections();
	});

	for (const [name, close] of [
		["bump", async () => stopBumpScheduler?.()],
		["allkeyshop", invalidateSharedSession],
		["suppliers", cleanupSuppliersSession],
	] as const) {
		try {
			await close();
		} catch (error) {
			console.error(`❌ [SHUTDOWN] Falha ao encerrar ${name}:`, error);
		}
	}

	clearTimeout(giveUp);
	console.log("✅ [SHUTDOWN] Encerrado.");
	process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
