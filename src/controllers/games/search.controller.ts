import { fileContentSchema } from "@/schemas/game.schema";
import type { Request, Response } from "express";
import { searchGamesService } from "@/services/game-search.service";
import { ZodError } from "zod";

export const searchGames = async (req: Request, res: Response) => {
	try {
		const validatedData = fileContentSchema.parse(req.body);
		const result = await searchGamesService(validatedData);

		return res.status(200).json({
			success: true,
			data: result,
		});
	} catch (error) {
		console.error("❌ [ERROR] Game search failed:", error);

		if (error instanceof ZodError) {
			const errorMessage = error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join(", ");

			return res.status(400).json({
				success: false,
				error: "Validation failed",
				details: errorMessage,
			});
		}

		return res.status(500).json({
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		});
	}
};
