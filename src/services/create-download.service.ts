import type { GameAnalysisResult } from "@/types/games.js";
import { MulterRequest } from "@/types/MulterRequest.js";
import fs from "node:fs";
import path from "path";

export const createDownloadService = async (filePath: string, gamePrices: GameAnalysisResult, req: MulterRequest): Promise<string> => {
    let responseFile: string = "";
    let fullLine: string = "";
    const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

    for (const game of gamePrices.games) {
        fullLine = `\t${date}\t${game.GamivoPrice}\t\t\t\t\t${game.popularity}\t${game.region}\t\t${game.name}\n`;
        responseFile += fullLine;
    }

    const originalName = req.file?.originalname || "file.txt";
    const baseName = path.parse(originalName).name; // remove extensão original
    const resultName = `${baseName}-result.txt`;
    console.log(resultName);

    console.log(`✅ [INFO] File ${resultName} created successfully: `);
    console.log(responseFile);

    fs.writeFileSync(filePath, responseFile);
    return resultName;
}