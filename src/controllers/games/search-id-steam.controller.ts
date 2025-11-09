import type { Request, Response } from "express";
import { ZodError } from "zod";
import { fileContentIdSteamSchema } from "@/schemas/game.schema.js";
import { searchGamesIdSteamService } from "@/services/game-search.service.js";

export const searchGamesIdSteam = async (req: Request, res: Response) => {
  try {
    const validatedData = fileContentIdSteamSchema.parse(req.body);
    const result = await searchGamesIdSteamService(validatedData);

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
