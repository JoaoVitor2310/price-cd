import type { Request, Response } from "express";
import { ZodError } from "zod";
import { gameSearchSchema } from "@/schemas/game.schema.js";
import { PriceGames } from "@/application/games/services/price-games.js";
import { SearchGamesUseCase } from "@/application/games/use-cases/search-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";

// Dependências agora entram pelo construtor. No app Nest quem monta isso é o
// container (`src/nest/games/games.module.ts`); aqui continua sendo à mão, até
// o Express sair de cena.
const searchGamesUseCase = new SearchGamesUseCase(
	new PriceGames(new SteamChartsPopularityFetcher(), new AllKeyShopPriceFetcher()),
);

export const searchGames = async (req: Request, res: Response) => {
	try {
		const validatedData = gameSearchSchema.parse(req.body);

		const result = await searchGamesUseCase.execute(validatedData);

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
