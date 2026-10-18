type WithPopularity = { popularity: number };

export const worthyByPopularity = <T extends WithPopularity>(
	games: T[],
	minPopularity: number,
): T[] => {
	if (minPopularity === 0) return games;
	return games.filter((game) => game.popularity >= minPopularity);
};

/** Um jogo que o SteamCharts não devolveu: sem dado nenhum além do nome pedido. */
export type UnratedGame = { id: number; name: string; popularity: 0 };

/**
 * Devolve todo nome pedido, na ordem pedida: o que o SteamCharts achou fica como veio,
 * e o que não achou vira um jogo de popularidade 0.
 *
 * "Não achado vale 0" é o que deixa o tier decidir sozinho o destino do jogo: com
 * mínimo 0, 0 passa e o jogo volta no resultado (o fornecedor vende o bundle inteiro,
 * inclusive o que o SteamCharts desconhece); com mínimo 1 ou mais, 0 não passa e o
 * jogo cai, como sempre caiu. Não existe regra separada para "sem dados".
 *
 * Mistura dois casos que o SteamCharts não distingue: jogo que não existe lá e falha
 * de rede/429 na consulta — o fetcher devolve `null` para os dois.
 */
export const withUnratedGames = <T extends { name: string }>(
	requested: string[],
	found: T[],
): Array<T | UnratedGame> => {
	const byName = new Map(found.map((game) => [game.name, game]));

	return requested.map(
		(name, index) =>
			byName.get(name) ?? { id: index, name, popularity: 0 as const },
	);
};
