import type { Request, Response } from "express";
import { ZodError } from "zod";
import { fileContentIdSteamSchema, fileContentIdSteamResponseSchema } from "@/schemas/game.schema.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";

const popularityFetcher = new SteamChartsPopularityFetcher();

export const searchGamesIdSteam = async (req: Request, res: Response) => {
  try {
    const validatedData = fileContentIdSteamSchema.parse(req.body);

    const gameNames = validatedData.games.map((game) => game.name);
    const steamChartsResults = await popularityFetcher.fetch(gameNames, 1);

    const gamesWithSteamId = validatedData.games.map((originalGame) => {
      const steamData = steamChartsResults.find(
        (result) => result.name === originalGame.name,
      );
      return {
        id: originalGame.id,
        name: originalGame.name,
        id_steam: steamData?.id_steam,
      };
    });

    const result = fileContentIdSteamResponseSchema.parse({ games: gamesWithSteamId });

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
