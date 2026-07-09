import type { Request, Response } from "express";
import { ZodError } from "zod";
import { researchGamesBodySchema } from "@/schemas/game.schema.js";
import { ResearchGamesUseCase } from "@/application/games/research-games.use-case.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";

const researchGamesUseCase = new ResearchGamesUseCase();
const popularityFetcher = new SteamChartsPopularityFetcher();
const priceFetcher = new AllKeyShopPriceFetcher();

let _tradeImporter: HttpGameTradeImporter | undefined;
function getTradeImporter(): HttpGameTradeImporter {
	if (!_tradeImporter) {
		const baseUrl = process.env.SISTEMA_ESTOQUE_URL?.trim();
		const secret = process.env.EXTERNAL_SECRET?.trim();
		if (!baseUrl) throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");
		if (!secret) throw new Error("EXTERNAL_SECRET is not defined in .env");
		_tradeImporter = new HttpGameTradeImporter(baseUrl, secret);
	}
	return _tradeImporter;
}

function isAuthenticated(token: string | undefined): boolean {
	const internalSecret = process.env.INTERNAL_SECRET?.trim();
	return !!internalSecret && token === internalSecret;
}

export const researchGames = async (req: Request, res: Response) => {
	try {
		const { gameNames, minPopularity, checkGamivoOffer, steam_id, list_code, internal_secret, title } = researchGamesBodySchema.parse(req.body);

		const authenticated = isAuthenticated(internal_secret);

		const result = await researchGamesUseCase.execute({
			gameNames,
			minPopularity,
			checkGamivoOffer,
			supplierSteamId: steam_id,
			listCode: list_code,
			title,
			popularityFetcher,
			priceFetcher,
			tradeImporter: authenticated ? getTradeImporter() : undefined,
		});

		if (authenticated) {
			res.status(200).json({ success: true });
			return;
		}

		res.status(200).json({ success: true, demo: true, games: result });
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
