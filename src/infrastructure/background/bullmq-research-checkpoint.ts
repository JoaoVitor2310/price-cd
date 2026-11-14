import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type {
	ResearchCheckpoint,
	ResearchTradeOutcome,
} from "@/application/games/ports/research-games-runner.port.js";
import type { BullmqJob } from "@/infrastructure/background/bullmq-clients.js";
import {
	CHECKPOINT_KEY,
	readResearchCheckpoint,
	type StoredResearchCheckpoint,
} from "@/infrastructure/background/research-job-payload.js";
import { errorMessage } from "@/lib/error-message.js";
import { withTimeout } from "@/lib/with-timeout.js";

/** Teto para gravar um marco: não pode segurar a pesquisa com o Redis travado. */
const SAVE_TIMEOUT_MS = 5000;

/**
 * O `ResearchCheckpoint` sobre o dado do próprio job (`job.updateData`): o
 * progresso fica ao lado do pedido, e sobrevive ao desligamento e à falha junto
 * com ele. A próxima tentativa — ou o boot depois de um deploy — lê o que a
 * anterior guardou.
 *
 * **Nunca lança**, como a porta pede: gravar falhou (Redis fora, travado) fica no
 * log, e a próxima tentativa só perde o atalho.
 */
export const bullmqResearchCheckpoint = (
	job: Pick<BullmqJob, "id" | "data" | "updateData">,
): ResearchCheckpoint => {
	const stored = readResearchCheckpoint(job.data);
	let current: StoredResearchCheckpoint = stored;

	const save = async (next: StoredResearchCheckpoint): Promise<void> => {
		current = { ...current, ...next };
		const data = {
			...(typeof job.data === "object" && job.data !== null ? job.data : {}),
			[CHECKPOINT_KEY]: current,
		};
		try {
			await withTimeout(job.updateData(data), SAVE_TIMEOUT_MS);
		} catch (error) {
			console.warn(
				`⚠️ [QUEUE] Could not save the progress of research job ${job.id} (${errorMessage(error)}) — a retry researches again.`,
			);
		}
	};

	return {
		pricedGames: stored.pricedGames,
		outcome: stored.outcome,
		savePricedGames: (pricedGames: GameTradeInput[]) => save({ pricedGames }),
		saveOutcome: (outcome: ResearchTradeOutcome) => save({ outcome }),
	};
};
