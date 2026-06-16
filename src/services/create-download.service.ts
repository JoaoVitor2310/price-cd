import type { GameAnalysisResult } from "@/application/games/game.types.js";
import { formatGameResultLine } from "@/helpers/format-game-result.js";
import fs from "node:fs";
import path from "path";

export const createDownloadService = async (
	filePath: string,
	gamePrices: GameAnalysisResult,
	originalName: string,
): Promise<string> => {
	const responseFile = gamePrices.games
		.map((game) =>
			formatGameResultLine({
				name: game.name,
				price: game.GamivoPrice?.toFixed(2).replace(".", ",") ?? "",
				popularity: game.popularity,
				region: game.region,
			})
		)
		.join("\n");

	const baseName = path.parse(originalName).name;
	const resultName = `${baseName}-result.txt`;

	console.log(`✅ [INFO] File ${resultName} created successfully: `);
	console.log(responseFile);

	fs.writeFileSync(filePath, responseFile);
	return resultName;
};
