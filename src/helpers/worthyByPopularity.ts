export const worthyByPopularity = (price: number, minPopularity: number, popularity: number): number | false => {
    if (popularity < minPopularity) {
        return false;
    }
    return price;
}