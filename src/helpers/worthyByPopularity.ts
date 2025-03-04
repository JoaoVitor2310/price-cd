import { foundGames } from "../interfaces/foundGames";

export const worthyByPopularity = (foundGames: foundGames[], minPopularity: number): foundGames[] => {
    
    return foundGames.filter(game => game.popularity >= minPopularity);
    // for (const [index, game] of foundGames.entries()) {
    //     if (game.popularity < minPopularity) {
            
    //     }
    // }
    // return foundGames;
}