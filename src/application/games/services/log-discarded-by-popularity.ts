import { type PopularityTiers, tierFor } from "@/domain/games/search-criteria.js";

type Discarded = { name: string; popularity: number; GamivoPrice?: number };

/**
 * O par do `logDiscardedByPrice`: um jogo descartado pelo tier exato já passou pelo
 * SteamCharts e pelo AllKeyShop, então sem esta linha ele some depois de um
 * "Price found" e o log dá a entender que entrou no resultado.
 */
export const logDiscardedByPopularityTier = (
	tooUnpopular: Discarded[],
	tiers: PopularityTiers,
): void => {
	for (const game of tooUnpopular) {
		const price = game.GamivoPrice ?? 0;
		const { side, minimum } = tierFor(tiers, price);
		const where = side === "upToThreshold" ? "up to" : "above";
		console.log(
			`👥 [INFO] Discarded "${game.name}" — popularity ${game.popularity} is below ${minimum}, the minimum for games priced ${where} €${tiers.priceThresholdEuro.toFixed(2)} (€${price.toFixed(2)}).`,
		);
	}
};
