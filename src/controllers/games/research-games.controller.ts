import type { Request, Response } from "express";
import { ZodError } from "zod";
import { researchGamesBodySchema } from "@/schemas/game.schema.js";
import {
	enqueueResearchGamesService,
	researchGamesDemoService,
} from "@/services/games/research-games.service.js";

function isAuthenticated(token: string | undefined): boolean {
	const internalSecret = process.env.INTERNAL_SECRET?.trim();
	return !!internalSecret && token === internalSecret;
}

export const researchGames = async (req: Request, res: Response) => {
	try {
		const { gameNames, minPopularity, checkGamivoOffer, steam_id, list_code, internal_secret, title } = researchGamesBodySchema.parse(req.body);

		const request = {
			gameNames,
			minPopularity,
			checkGamivoOffer,
			supplierSteamId: steam_id,
			listCode: list_code,
			title,
		};

		if (isAuthenticated(internal_secret)) {
			await enqueueResearchGamesService(request);
			res.status(202).json({ success: true, status: "queued" });
			return;
		}

		const games = await researchGamesDemoService(request);
		res.status(200).json({ success: true, demo: true, games });
	} catch (error) {
		if (error instanceof ZodError) {
			const errorMessage = error.issues.map((issue) => issue.message).join(", ");
			console.error("❌ [ERROR] Invalid file content:", errorMessage);
			res.status(400).json({ success: false, data: `Invalid file content: ${errorMessage}` });
			return;
		}

		if (error instanceof Error) {
			console.error("❌ [ERROR] Internal server error:", error);
			res.status(500).json({ success: false, error: "Internal server error.", details: error.message });
			return;
		}

		res.status(500).json({ success: false, error: "Internal server error.", details: "Unknown error" });
	}
};
