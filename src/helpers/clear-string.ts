export const clearString = (stringToSearch: string): string => {
	// Remove todas as ocorrências de "MX" (case-insensitive) // MX é chinês simplificado, mas pode ser confundido com 1010 em romano
	stringToSearch = stringToSearch.replace(/\/mx\b/gi, "");

	const romanRegex = /\b(?!dlc\b)[IVXLCDM]+\b/gi;

	// Substituir números romanos pelo equivalente decimal
	stringToSearch = stringToSearch.replace(romanRegex, (match) => {
		const decimalValue = RomantoInt(match.toUpperCase());
		return decimalValue.toString(); // Converter para string para colocar de volta
	});

	// Remove "-", e, quando "-", remove também o espaço subsequente, colocando tudo em minúsculas para melhor reconhecimento dos jogos
	stringToSearch = stringToSearch.replace(/-\s?/g, "").toLowerCase();

	// Remove "™", ":", "®", "!", "?", ".", "(", ")", "[", "]", "{", "}", "&", "*", "+", "^" e 
	stringToSearch = stringToSearch.replace(/[™:®!?().[\]{}&*+^;]/g, "");

	// Remove "|" e qualquer espaço após ele
	stringToSearch = stringToSearch.replace(/\|\s*/g, ""); // Substitui "|" e qualquer espaço subsequente

	// Remove "'" e qualquer espaço após ele
	stringToSearch = stringToSearch.replace(/'\s*/g, "");

	// Remove "’" e qualquer espaço após ele
	stringToSearch = stringToSearch.replace(/’\s*/g, "");

	// Remove "the" (case-insensitive) e qualquer espaço subsequente
	stringToSearch = stringToSearch.replace(/the\s*/gi, "");

	// Remove todas as vírgulas
	stringToSearch = stringToSearch.replace(/,/g, "");

	stringToSearch = expandKNumbers(stringToSearch);

	return stringToSearch;
};

const RomantoInt = (romanStr: string): number => {
	let num = 0;
	const objRoman: Record<string, number> = {
		M: 1000,
		D: 500,
		C: 100,
		L: 50,
		X: 10,
		V: 5,
		I: 1,
	};

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

const expandKNumbers = (text: string): string => {
	return text.replace(/\b(\d+(?:\.\d+)?)k\b/gi, (_, numStr: string) => {
		const num = parseFloat(numStr);
		const expanded = num * 1000;
		return expanded.toString();
	});
}

/*
** Removes Roman numerals from a string and normalizes spaces.
*/
export const clearRomanNumber = (stringToSearch: string): string => {
	const romanNumeralsRegex = /\b[IVXLCDM]+\b/g;

	// Substituir os números romanos por uma string vazia (removê-los)
	const cleanedString = stringToSearch.replace(romanNumeralsRegex, "").trim();

	// Remover espaços extras entre palavras
	const normalizedString = cleanedString.replace(/\s{2,}/g, " ");

	return normalizedString;
};


export const clearEdition = (stringToSearch: string): string => {
	const edition = /\bedition\b/gi; // Detectar "edition" como palavra separada
	const definitiveEditionRegex = /\bdefinitive\b/gi;
	const standardEditionRegex = /\bstandard\b/gi;
	const gameOfTheYear = /\bgame of the year\b/gi;
	const goty = /\bgoty\b/gi;
	const gotyPoint = /\bg.o.t.y\b/gi;
	const deluxe = /\bdeluxe\b/gi;
	const premium = /\bpremium\b/gi;
	const bundle = /\bbundle\b/gi;
	const special = /\bspecial\b/gi;
	const complete = /\bcomplete\b/gi;
	const dayOne = /\bday\s?one\b/gi;

	const rowRegex = /\brow\b/gi; // Detectar "ROW" como palavra separada
	const euRegex = /\beu\b/gi; // Detectar "EU" como palavra separada

	// Remover "Definitive Edition"
	let normalizedString = stringToSearch
		.replace(edition, "")
		.replace(definitiveEditionRegex, "")
		.replace(standardEditionRegex, "")
		.replace(gameOfTheYear, "")
		.replace(goty, "")
		.replace(gotyPoint, "")
		.replace(deluxe, "")
		.replace(premium, "")
		.replace(bundle, "")
		.replace(special, "")
		.replace(complete, "")
		.replace(dayOne, "")
		.replace(rowRegex, "") // Remove "ROW"
		.replace(euRegex, ""); // Remove "EU"

	// Remover espaços extras para evitar fragmentos
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim(); // Normaliza a string para evitar múltiplos espaços

	return normalizedString;
};


export const clearDLC = (stringToSearch: string): string => {
	// Combined regex pattern to match all DLC-related terms as whole words
	const dlcPattern = /\b(?:dlc|expansion|season|pass)\b/gi;

	// Remove all DLC-related terms in a single pass
	let normalizedString = stringToSearch.replace(dlcPattern, "");

	// Remove extra spaces and trim
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim();

	return normalizedString;
};


export const hasEdition = (str: string): Set<string> => {
	const regexList: RegExp[] = [
		/\bedition\b/gi,
		/\bdefinitive\b/gi,
		/\bstandard\b/gi,
		/\bgame of the year\b/gi,
		/\bgoty\b/gi,
		/\bg\.o\.t\.y\b/gi,
		/\bdeluxe\b/gi,
		/\bpremium\b/gi,
		/\bbundle\b/gi,
		/\bspecial\b/gi,
		/\bcomplete\b/gi,
	];
	const foundKeywords = new Set<string>();

	for (const regex of regexList) {
		if (regex.test(str)) {
			foundKeywords.add(regex.source);
		}
	}

	return foundKeywords;
};

/**
 * Identifies the region lock of a game based on a string.
 *
 * @param str - The string containing region information (e.g., "STEAM ROW", "EU").
 * @returns The region code: "row", "eu", or "global" if no specific region is found.
 */
export const getRegion = (str: string): string => {
	const lowerStr = str.toLowerCase();

	if (/\brow\b/.test(lowerStr)) return "row";
	if (/\beu\b/.test(lowerStr)) return "eu";

	return "global";
};

/**
 * Removes the region from a string.
 * @param str - The string to remove the region from.
 * @returns The string without the region.
 */
export const removeRegion = (str: string): string => {
	const regionRegex = /\b(?:row|eu|global)\b/gi;
	return str.replace(regionRegex, "");
};


export const searchRegion = (stringToSearch: string) => {
	const dlcRegex = /\bdlc\b/gi;
	const expansionRegex = /\bexpansion\b/gi;
	// Pesquisar por região

	// Remover todas as ocorrências de "dlc" ou "DLC"
	let normalizedString = stringToSearch
		.replace(dlcRegex, "")
		.replace(expansionRegex, "");

	// Remover espaços extras para evitar fragmentos
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim(); // Normaliza a string para remover múltiplos espaços

	return normalizedString;
};

