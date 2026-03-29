import type { ListResultFormatter } from "@/application/lists/ports/list-run.ports.js";
import { GameAnalysisResult } from "@/types/games";

export class FormatListResult implements ListResultFormatter {
	formatListResult(gamePrices: GameAnalysisResult, id_steam: string): string {
		
		let listResult = ``;
		const date = new Date().toLocaleDateString("pt-BR", {
			day: "2-digit",
			month: "2-digit",
			year: "numeric",
		});

		const steamProfileUrl = `https://steamcommunity.com/profiles/${id_steam}`;


		for (const game of gamePrices.games) {
			const fullLine = `${date}\t${game.GamivoPrice}\t${steamProfileUrl}\t\t\t\t${game.popularity}\t${game.region}\t\t${game.name}\n`;
			listResult += fullLine;
		}

		return listResult;
	}
}

export const formatList = (): ListResultFormatter => new FormatListResult();
