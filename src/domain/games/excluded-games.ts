type WithName = { name: string };

const EXCLUDED_GAMES = new Set([
	"smite 2",
]);

export const filterExcludedGames = <T extends WithName>(games: T[]): T[] =>
	games.filter((g) => !EXCLUDED_GAMES.has(g.name.toLowerCase().trim()));
