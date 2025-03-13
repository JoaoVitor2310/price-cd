import { foundGames } from "../types/foundGames";

export const worthyByPopularity = (foundGames: foundGames[], minPopularity: number): foundGames[] => {
    if(minPopularity === 0) return foundGames;
    return foundGames.filter(game => game.popularity >= minPopularity);
}