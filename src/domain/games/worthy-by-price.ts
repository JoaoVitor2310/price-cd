type WithPrice = { GamivoPrice?: number };

// Abaixo desse valor o lucro por negociação vira centavos e não paga
// o tempo de negociar o jogo com o fornecedor.
export const MIN_PRICE_EURO = 0.5;

export type PricePartition<T> = { worthy: T[]; tooCheap: T[] };

/**
 * Separa os jogos nos dois lados do piso de preço em vez de só filtrar:
 * quem descarta precisa conseguir dizer o que descartou, sem reimplementar o corte.
 */
export const partitionByPrice = <T extends WithPrice>(games: T[]): PricePartition<T> => {
	const worthy: T[] = [];
	const tooCheap: T[] = [];

	for (const game of games) {
		if (game.GamivoPrice != null && game.GamivoPrice > MIN_PRICE_EURO) {
			worthy.push(game);
		} else {
			tooCheap.push(game);
		}
	}

	return { worthy, tooCheap };
};
