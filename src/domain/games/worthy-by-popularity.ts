import type { FoundGames } from "@/types/games.js";

export const worthyByPopularity = (
	foundGames: FoundGames[],
	minPopularity: number,
): FoundGames[] => {
	if (minPopularity === 0) return foundGames;
	return foundGames.filter((game) => game.popularity >= minPopularity);
};
