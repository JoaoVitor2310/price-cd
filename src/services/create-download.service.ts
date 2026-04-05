import type { GameAnalysisResult } from "@/types/games.js";
import fs from "node:fs";
import path from "path";

export const createDownloadService = async (
	filePath: string,
	gamePrices: GameAnalysisResult,
	originalName: string,
): Promise<string> => {
	let responseFile = "";
	const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

	for (const game of gamePrices.games) {
		responseFile += `\t${date}\t${game.GamivoPrice}\t\t\t\t\t${game.popularity}\t${game.region}\t\t${game.name}\n`;
	}

	const baseName = path.parse(originalName).name;
	const resultName = `${baseName}-result.txt`;

	console.log(`✅ [INFO] File ${resultName} created successfully: `);
	console.log(responseFile);

	fs.writeFileSync(filePath, responseFile);
	return resultName;
};
