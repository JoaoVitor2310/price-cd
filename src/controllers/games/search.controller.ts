import type { Request, Response } from "express";
import { ZodError } from "zod";
import { fileContentSchema } from "@/schemas/game.schema.js";
import { SearchGamesUseCase } from "@/application/games/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";

const searchGamesUseCase = new SearchGamesUseCase();
const popularityFetcher = new SteamChartsPopularityFetcher();
const priceFetcher = new AllKeyShopPriceFetcher();

export const searchGames = async (req: Request, res: Response) => {
	try {
		const validatedData = fileContentSchema.parse(req.body);

		const result = await searchGamesUseCase.execute({
			...validatedData,
			popularityFetcher,
			priceFetcher,
		});

		res.status(200).json({
			success: true,
			data: result,
		});
		return;
	} catch (error) {
		console.error("❌ [ERROR] Game search failed:", error);

		if (error instanceof ZodError) {
			const errorMessage = error.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join(", ");

			res.status(400).json({
				success: false,
				error: "Validation failed",
				details: errorMessage,
			});
			return;
		}

		res.status(500).json({
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		});
		return;
	}
};
