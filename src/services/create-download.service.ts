import type { GameAnalysisResult } from "@/types/games";
import { MulterRequest } from "@/types/MulterRequest";
import fs from "node:fs";
import path from "path";

export const createDownloadService = async (filePath: string, gamePrices: GameAnalysisResult, req: MulterRequest): Promise<string> => {
    let responseFile: string = "";
    let fullLine: string = "";

    for (const game of gamePrices.games) {
        fullLine = `G2A\t${game.GamivoPrice}\tKinguin\t\t\t\t${game.popularity}\t${game.name}\n`;
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