type WithPopularity = { popularity: number };

export const worthyByPopularity = <T extends WithPopularity>(
	games: T[],
	minPopularity: number,
): T[] => {
	if (minPopularity === 0) return games;
	return games.filter((game) => game.popularity >= minPopularity);
};
