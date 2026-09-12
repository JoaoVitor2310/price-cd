type WithPrice = { GamivoPrice?: number };

// Abaixo desse valor o lucro por negociação vira centavos e não paga
// o tempo de negociar o jogo com o fornecedor.
export const MIN_PRICE_EURO = 0.5;

export type PricePartition<T> = { worthy: T[]; tooCheap: T[] };

/**
 * Separa os jogos nos dois lados do piso de preço em vez de só filtrar:
 * quem descarta precisa conseguir dizer o que descartou, sem reimplementar o corte.
 *
 * O piso é parametrizável (default `MIN_PRICE_EURO`) porque nem todo fluxo o quer:
 * a pesquisa de bundle, por exemplo, aceita jogos abaixo do piso passando `minPrice`
 * menor (ex.: `0`). Jogo sem preço cai sempre no lado descartado, qualquer que seja
 * o piso — sem oferta não há o que negociar. O corte segue estrito (`>`).
 */
export const partitionByPrice = <T extends WithPrice>(
	games: T[],
	minPrice: number = MIN_PRICE_EURO,
): PricePartition<T> => {
	const worthy: T[] = [];
	const tooCheap: T[] = [];

	for (const game of games) {
		if (game.GamivoPrice != null && game.GamivoPrice > minPrice) {
			worthy.push(game);
		} else {
			tooCheap.push(game);
		}
	}

	return { worthy, tooCheap };
};
