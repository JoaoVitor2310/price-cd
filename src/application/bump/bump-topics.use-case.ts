import type { SteamTradesBumper } from "@/application/bump/ports/steam-trades-bumper.port.js";

export type BumpTopicsInput = {
	steamId: string;
	bumper: SteamTradesBumper;
};

export type BumpTopicsOutput = {
	bumped: string[];
	cooldown: string[];
	failed: string[];
};

/**
 * Tenta bumpar todos os tópicos ativos do usuário.
 * Classifica cada resultado em: bumped (sucesso), cooldown (ainda no timer),
 * ou failed (erro inesperado).
 */
export class BumpTopicsUseCase {
	async execute(input: BumpTopicsInput): Promise<BumpTopicsOutput> {
		const { steamId, bumper } = input;
		const results = await bumper.bumpUserTopics(steamId);

		const bumped: string[] = [];
		const cooldown: string[] = [];
		const failed: string[] = [];

		for (const result of results) {
			if (result.success) {
				bumped.push(result.code);
			} else if (isCooldownMessage(result.message)) {
				cooldown.push(result.code);
			} else {
				failed.push(result.code);
			}
		}

		return { bumped, cooldown, failed };
	}
}

function isCooldownMessage(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("wait") ||
		lower.includes("hour") ||
		lower.includes("minute") ||
		lower.includes("cooldown") ||
		lower.includes("too soon") ||
		lower.includes("already bumped")
	);
}
