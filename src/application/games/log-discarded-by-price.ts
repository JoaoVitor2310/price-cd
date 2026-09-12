import { MIN_PRICE_EURO } from "@/domain/games/worthy-by-price.js";

type Discarded = { name: string; GamivoPrice?: number };

/**
 * Sem isto o jogo some entre o "Price found" do fetcher e o resultado final,
 * e o log dá a entender que ele entrou na Trade.
 */
export const logDiscardedByPrice = (
	tooCheap: Discarded[],
	minPrice: number = MIN_PRICE_EURO,
): void => {
	for (const game of tooCheap) {
		const price = game.GamivoPrice == null ? "no price" : `€${game.GamivoPrice.toFixed(2)}`;
		console.log(
			`💸 [INFO] Discarded "${game.name}" — ${price} is not above the €${minPrice.toFixed(2)} floor.`,
		);
	}
};
