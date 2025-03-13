export const clearString = (stringToSearch: string): string => {

    const romanRegex = /\b(?!dlc\b)[IVXLCDM]+\b/gi;

    // Substituir números romanos pelo equivalente decimal
    stringToSearch = stringToSearch.replace(romanRegex, (match) => {
        const decimalValue = RomantoInt(match.toUpperCase()); 
        return decimalValue.toString(); // Converter para string para colocar de volta
    });

    // Remove "-", e, quando "-", remove também o espaço subsequente, colocando tudo em minúsculas para melhor reconhecimento dos jogos
    stringToSearch = stringToSearch.replace(/-\s?/g, '').toLowerCase();

    // Remove "™", ":", "®", "!", "?", ".", "(", ")", "[", "]", "{", "}", "&", "*", "+" e "^"
    stringToSearch = stringToSearch.replace(/[™:®!?().[\]{}&*+^]/g, '');

    // Remove "|" e qualquer espaço após ele
    stringToSearch = stringToSearch.replace(/\|\s*/g, ''); // Substitui "|" e qualquer espaço subsequente
    
    // Remove "'" e qualquer espaço após ele
    stringToSearch = stringToSearch.replace(/\'\s*/g, '');
    
    // Remove "’" e qualquer espaço após ele
    stringToSearch = stringToSearch.replace(/\’\s*/g, '');
    
    // Remove "the" (case-insensitive) e qualquer espaço subsequente
    stringToSearch = stringToSearch.replace(/the\s*/gi, '');
    
    // Remove todas as vírgulas
    stringToSearch = stringToSearch.replace(/,/g, '');


    return stringToSearch;
}

export function RomantoInt(romanStr: string): number {
    let num = 0;
    const objRoman: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };

    for (let i = 0; i < romanStr.length; i++) {
        const current = objRoman[romanStr[i]] || 0; // Garante que não seja undefined
        const next = objRoman[romanStr[i + 1]] || 0;

        if (current < next) {
            num -= current;
        } else {
            num += current;
        }
    }

    return num;
}



// Testar a função
// const testString = "Sid Meier's Civilization IV: Beyond the Sword";
// const result = clearString(testString);
// console.log(result); // Deve retornar: "street fighter 6"