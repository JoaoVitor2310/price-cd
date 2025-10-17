import fs from "node:fs";
import type { Response } from "express";
import { ZodError } from "zod";
import { worthyByPopularity } from "@/helpers/worthy-by-popularity";
import {
	type FileContent,
	validateFileContent,
	validateFoundGames,
} from "@/schemas/game.schema";
import { searchGamivo } from "@/services/search-gamivo";
import { searchSteamCharts } from "@/services/search-steam-charts";
import type { MulterRequest } from "@/types/MulterRequest";

// import searchG2A from "../service/searchG2A";

const timeOpts: Intl.DateTimeFormatOptions = {
	timeZone: "America/Sao_Paulo",
	hour12: false,
};

export const uploadFile = async (req: MulterRequest, res: Response) => {
	if (!req.file) {
		res.status(400).send("Nenhum arquivo enviado.");
		return;
	}

	const startDate = new Date();
	const startTime = startDate.toLocaleTimeString("pt-BR", timeOpts);

	let responseFile: string = "";
	let fullLine: string = "";

	const filePath = req.file.path;
	let fileContent: string;

	try {
		fileContent = fs.readFileSync(filePath, "utf8");
	} catch (error) {
		console.error("❌ [ERROR] Failed to read input file:", error);
		res.status(500).send("Erro ao ler o arquivo.");
		return;
	}

	let validatedContent: FileContent;
	try {
		validatedContent = validateFileContent(fileContent);
	} catch (error) {
		if (error instanceof ZodError) {
			const errorMessage = error.issues
				.map((issue) => issue.message)
				.join(", ");
			console.error("❌ [ERROR] Invalid file content:", errorMessage);
			res.status(400).send(`Erro no conteúdo do arquivo: ${errorMessage}`);
			return;
		}
		if (error instanceof Error) {
			console.error(
				"❌ [ERROR] Failed to validate file content:",
				error.message,
			);
		} else {
			console.error("❌ [ERROR] Failed to validate file content:", error);
		}
		res.status(500).send("Erro ao validar o conteúdo do arquivo.");
		return;
	}

	const { minPopularity, gameNames } = validatedContent;

	let foundGames = await searchSteamCharts(gameNames);

	try {
		foundGames = validateFoundGames(foundGames);
	} catch (error: unknown) {
		if (error instanceof ZodError) {
			const errorMessage = error.issues
				.map((issue) => issue.message)
				.join(", ");
			console.error("❌ [ERROR] Invalid game data:", errorMessage);
			res.status(500).send(`Erro nos dados dos jogos: ${errorMessage}`);
			return;
		}
		if (error instanceof Error) {
			console.error("❌ [ERROR] Failed to validate game data:", error.message);
		} else {
			console.error("❌ [ERROR] Failed to validate game data:", error);
		}
		res.status(500).send("Erro inesperado ao validar dados dos jogos.");
		return;
	}

	foundGames = worthyByPopularity(foundGames, minPopularity);
	foundGames = await searchGamivo(foundGames);

	for (const game of foundGames) {
		fullLine = `G2A\t${game.GamivoPrice}\tKinguin\t\t\t\t${game.popularity}\t${game.name}\n`;
		responseFile += fullLine;
	}

	fs.writeFileSync(filePath, responseFile);

	res.download(filePath, "resultado-price-researcher.txt", (err) => {
		// Verifica se houve algum erro durante o download

		const endDate = new Date();
		const endTime = endDate.toLocaleTimeString("pt-BR", timeOpts);
		const duration = endDate.getTime() - startDate.getTime();

		console.log("⏰ [TIMING] Process completed:", {
			startTime,
			endTime,
			duration: `${duration}ms`,
			durationSeconds: `${(duration / 1000).toFixed(2)}s`,
		});

		if (err) {
			console.error("❌ [ERROR] Failed to download result file:", err);
			fs.unlinkSync(filePath);
		} else {
			// Clean up temporary file after successful download
			fs.unlinkSync(filePath);
			console.log("✅ [INFO] File downloaded successfully");
		}
	});
};
