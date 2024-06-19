const clearEdition = (stringToSearch) => {
    const edition = /\bedition\b/gi; // Detectar "edition" como palavra separada
    const definitiveEditionRegex = /\bdefinitive\b/gi;
    const standardEditionRegex = /\bstandard\b/gi;
    const gameOfTheTear = /\bgame of the year\b/gi;
    const goty = /\bgoty\b/gi;
    const gotyPoint = /\bg.o.t.y\b/gi;
    const deluxe = /\bdeluxe\b/gi;
    const premium = /\bpremium\b/gi;
    const bundle = /\bbundle\b/gi;
    const special = /\bspecial\b/gi;
    
    const rowRegex = /\brow\b/gi; // Detectar "ROW" como palavra separada
    const euRegex = /\beu\b/gi; // Detectar "EU" como palavra separada

    // Remover "Definitive Edition"
    let normalizedString = stringToSearch
        .replace(edition, '')
        .replace(definitiveEditionRegex, '')
        .replace(standardEditionRegex, '')
        .replace(gameOfTheTear, '')
        .replace(goty, '')
        .replace(gotyPoint, '')
        .replace(deluxe, '')
        .replace(premium, '')
        .replace(bundle, '')
        .replace(special, '')
        .replace(rowRegex, '') // Remove "ROW"
        .replace(euRegex, ''); // Remove "EU"

    // Remover espaços extras para evitar fragmentos
    normalizedString = normalizedString.replace(/\s{2,}/g, ' ').trim(); // Normaliza a string para evitar múltiplos espaços

    return normalizedString;
};

export default clearEdition;