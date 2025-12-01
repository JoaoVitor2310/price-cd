
import fs from "node:fs";
import type { Response } from "express";
import { ZodError } from "zod";
import {
	validateFileContent,
	validateFileUpload,
} from "@/schemas/game.schema.js";
import type { MulterRequest } from "@/types/MulterRequest.js";
import { searchGamesService } from "@/services/game-search.service.js";
import { createDownloadService } from "@/services/create-download.service.js";

export const uploadFile = async (req: MulterRequest, res: Response) => {
	try {
		const validatedFile = validateFileUpload(req);

		const fileContent: string = fs.readFileSync(validatedFile.file.path, "utf8");

		const checkGamivoOffer = req.body.checkGamivoOffer ?? false;
		const validatedContent = validateFileContent(fileContent, checkGamivoOffer);

		const gamePrices = await searchGamesService(validatedContent);

		const resultName = await createDownloadService(validatedFile.file.path, gamePrices, req);

		res.download(validatedFile.file.path, resultName);

		return;
	} catch (error) {
		if (error instanceof ZodError) {
			const errorMessage = error.issues
				.map((issue) => issue.message)
				.join(", ");
			console.error("❌ [ERROR] Invalid file content:", errorMessage);
			res.status(400).json({
				success: false,
				data: `Erro no conteúdo do arquivo: ${errorMessage}`
			});
			return;
		}

		if (error instanceof Error) {
			console.error("❌ [ERROR] Internal server error:", error);
			res.status(500).json({
				success: false,
				error: "Internal server error.",
				details: error.message,
			});
			return;
		}

		res.status(500).json({
			success: false,
			error: "Internal server error.",
			details: "Unknown error",
		});
		return;
	}
};
