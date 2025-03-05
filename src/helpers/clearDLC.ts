export const clearDLC = (stringToSearch: string): string => {
    const dlcRegex = /\bdlc\b/gi; // Expressão regular para detectar "dlc" como palavra separada
    const expansionRegex = /\bexpansion\b/gi; // Expressão regular para detectar "Expansion" como palavra separada
    const season = /\bseason\b/gi; // Expressão regular para detectar "Expansion" como palavra separada
    const pass = /\bpass\b/gi; // Expressão regular para detectar "Expansion" como palavra separada

    // Remover todas as ocorrências de "dlc" ou "DLC"
    let normalizedString = stringToSearch
        .replace(dlcRegex, '')
        .replace(expansionRegex, '')
        .replace(season, '')
        .replace(pass, '')

    // Remover espaços extras para evitar fragmentos
    normalizedString = normalizedString.replace(/\s{2,}/g, ' ').trim(); // Normaliza a string para remover múltiplos espaços

    return normalizedString;
};