type Discarded = { name: string };

/**
 * Sem isto o jogo some entre o "Price found" do fetcher e o resultado final,
 * como acontecia quando o corte da Gamivo morava no scraper.
 */
export const logDiscardedByGamivoOffer = (withoutGamivo: Discarded[]): void => {
	for (const game of withoutGamivo) {
		console.log(
			`🏷️ [INFO] Discarded "${game.name}" — no Gamivo offer, and this search requires one.`,
		);
	}
};
