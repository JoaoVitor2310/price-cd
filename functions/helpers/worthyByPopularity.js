const worthyByPopularity = (price, minPopularity, popularity) => {
    const asString = popularity.toString(); // Converte para string
    popularity = parseInt(asString.replace('.', ''), 10); // Remove o ponto e transforma para inteiro

    const isBestBuy86 = process.env.isBestBuy86;


    if (popularity < minPopularity && isBestBuy86 == 'false') {
        return 'N';
    }

    if (isBestBuy86 == 'true' && popularity < minPopularity && price > 2.00) {
        return 'N';
    }
    
    const priceAsNumber = Number(price);
    return priceAsNumber.toFixed(2);

}

export default worthyByPopularity;