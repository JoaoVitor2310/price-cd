export const GAMIVO_MERCHANT_NAME = "GAMIVO";

export type OfferPrice = {
	merchant: string;
	originalPrice: number;
};

export const detectOfferTooLow = (offers: OfferPrice[]): number | null => {
	if (offers.length === 0) return null;

	let bestOffer: OfferPrice | null = null;
	let secondBestOffer: OfferPrice | null = null;

	for (const offer of offers) {
		if (!bestOffer || offer.originalPrice < bestOffer.originalPrice) {
			secondBestOffer = bestOffer;
			bestOffer = offer;
		} else if (!secondBestOffer || offer.originalPrice < secondBestOffer.originalPrice) {
			secondBestOffer = offer;
		}
	}

	if (!bestOffer) return null;

	const bestPrice = bestOffer.originalPrice;

	if (!secondBestOffer) return bestPrice;

	const secondBestOfferPrice = secondBestOffer.originalPrice;
	const difference = secondBestOfferPrice - bestPrice;

	const percentualDifference =
		secondBestOfferPrice > 1
			? 0.1 * secondBestOfferPrice
			: 0.05 * secondBestOfferPrice;

	if (difference >= percentualDifference) {
		return secondBestOfferPrice;
	}

	return bestPrice;
};

export const findGamivoOffer = <T extends OfferPrice>(offers: T[]): T | null => {
	return offers
		.filter(o => o.merchant === GAMIVO_MERCHANT_NAME)
		.sort((a, b) => a.originalPrice - b.originalPrice)[0] ?? null;
};

export const hasGamivoOffer = (offers: OfferPrice[]): boolean =>
	offers.some(o => o.merchant === GAMIVO_MERCHANT_NAME);

/**
 * O melhor preço da região/Edição, independente de haver oferta na Gamivo.
 *
 * "Exigir oferta na Gamivo" é critério do preset, e não mora mais aqui: o preço
 * vai para o cache como dado bruto e o corte é aplicado depois, por
 * `partitionByGamivoOffer` (ver `docs/adr/0008-cache-de-preco-em-redis.md`).
 */
export const bestOfferPrice = (offers: OfferPrice[]): number | null => {
	if (offers.length === 0) {
		console.log(`⚠️ [INFO] No prices found for the region.`);
		return null;
	}

	return detectOfferTooLow(offers);
};
