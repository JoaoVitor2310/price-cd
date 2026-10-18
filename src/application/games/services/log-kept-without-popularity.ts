type Kept = { name: string };

/**
 * O par de `logDiscardedByPopularityTier` para o caminho contrário: jogo que o
 * SteamCharts não devolveu e que ficou no resultado porque nenhum tier corta por
 * popularidade. Sem esta linha ele aparece no resultado com popularidade 0 e o log
 * não diz se o 0 é medido ou ausência de dado.
 */
export const logKeptWithoutPopularity = (kept: Kept[]): void => {
	for (const game of kept) {
		console.log(
			`⚠️ [INFO] "${game.name}" has no SteamCharts data — kept with popularity 0, since no popularity minimum applies.`,
		);
	}
};
