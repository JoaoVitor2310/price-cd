type WithGamivoOffer = { hasGamivoOffer?: boolean };

export type GamivoOfferPartition<T> = { worthy: T[]; withoutGamivo: T[] };

/**
 * O corte "exigir oferta na Gamivo" do preset, aplicado depois do preço.
 *
 * Morava dentro do scraper do AllKeyShop, que devolvia "sem preço" quando a
 * Gamivo faltava. Com o cache de preço, isso gravaria o resultado já filtrado
 * pelo critério de um preset, e outro preset que não exige Gamivo herdaria o
 * descarte. O scraper agora sempre informa o melhor preço e se há oferta na
 * Gamivo; quem corta é esta função. Ver `docs/adr/0008-cache-de-preco-em-redis.md`.
 *
 * Com `required: false` ninguém sai. Jogo sem a informação conta como sem oferta.
 */
export const partitionByGamivoOffer = <T extends WithGamivoOffer>(
	games: T[],
	required: boolean,
): GamivoOfferPartition<T> => {
	if (!required) return { worthy: [...games], withoutGamivo: [] };

	const worthy: T[] = [];
	const withoutGamivo: T[] = [];

	for (const game of games) {
		if (game.hasGamivoOffer === true) {
			worthy.push(game);
		} else {
			withoutGamivo.push(game);
		}
	}

	return { worthy, withoutGamivo };
};
