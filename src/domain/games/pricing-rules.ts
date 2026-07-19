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

export const bestOfferPrice = (offers: OfferPrice[], checkGamivoOffer: boolean): number | null => {
	if (offers.length === 0) {
		console.log(`⚠️ [INFO] No prices found for the region.`);
		return null;
	}

	const bestOffer = detectOfferTooLow(offers);
	if (bestOffer == null) return null;

	if (checkGamivoOffer) {
		const hasGamivoOffer = offers.some(o => o.merchant === GAMIVO_MERCHANT_NAME);
		if (!hasGamivoOffer) {
			console.log(`⚠️ [INFO] Gamivo offer not found.`);
			return null;
		}
	}

	return bestOffer;
};
