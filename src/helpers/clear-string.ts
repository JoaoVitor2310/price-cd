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
	stringToSearch = stringToSearch.replace(/\bthe\b\s*/gi, "");

	// Remove todas as vírgulas
	stringToSearch = stringToSearch.replace(/,/g, "");

	stringToSearch = expandKNumbers(stringToSearch);

	// Remove indicadores de quantidade como "x2", "X3", "2x", "10x"
	stringToSearch = stringToSearch.replace(/\bx\d+\b|\b\d+x\b/gi, "");

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


/**
 * Categorias canônicas de edição. Cada categoria mapeia para um ou mais padrões
 * que são SINÔNIMOS entre si (ex.: "GOTY", "Game of the Year" e "G.O.T.Y" são a
 * MESMA edição). Fonte única de verdade para `clearEdition` (remove todas) e
 * `hasEdition` (reporta quais categorias estão presentes) — assim as duas nunca
 * divergem.
 *
 * Os padrões NÃO usam a flag `g` de propósito: `hasEdition` chama `.test()`, que
 * é stateful com `g` (mantém `lastIndex`); o flag global é adicionado apenas na
 * hora de remover, dentro de `stripAll`.
 */
type EditionTier = { category: string; patterns: RegExp[] };

const EDITION_TIERS: EditionTier[] = [
	{ category: "definitive", patterns: [/\bdefinitive\b/i] },
	{ category: "goty", patterns: [/\bgame of the year\b/i, /\bgoty\b/i, /\bg\.o\.t\.y\b/i] },
	{ category: "deluxe", patterns: [/\bdeluxe\b/i] },
	{ category: "premium", patterns: [/\bpremium\b/i] },
	{ category: "bundle", patterns: [/\bbundle\b/i] },
	{ category: "special", patterns: [/\bspecial\b/i] },
	{ category: "complete", patterns: [/\bcomplete\b/i] },
	{ category: "day one", patterns: [/\bday\s?one\b/i] },
];

/**
 * Palavras removidas do nome para normalização, mas que NÃO identificam uma
 * edição discriminante — logo nunca entram na comparação de `hasEdition`.
 *
 * - "edition" sozinha não escolhe nenhuma edição (sempre acompanha um tier).
 * - "standard" NÃO é um tier premium: é a própria versão base do jogo (mesma
 *   key, mesmo preço). Uma listagem "Standard Edition" tem que casar com uma
 *   busca pelo jogo base — por isso `standard` é ruído, não categoria.
 * - tags de região são tratadas à parte por `getRegion`/`removeRegion`.
 */
const EDITION_NAME_NOISE: RegExp[] = [/\bedition\b/i, /\bstandard\b/i, /\brow\b/i, /\beu\b/i];

const stripAll = (str: string, patterns: RegExp[]): string => {
	let result = str;
	for (const pattern of patterns) {
		result = result.replace(new RegExp(pattern.source, "gi"), "");
	}
	return result;
};

/**
 * Remove todas as palavras de edição (tiers + "edition" solta) e tags de região
 * do nome, para normalizar antes de comparar. Não altera nomes sem edição.
 */
export const clearEdition = (stringToSearch: string): string => {
	let normalized = stringToSearch;
	for (const tier of EDITION_TIERS) {
		normalized = stripAll(normalized, tier.patterns);
	}
	normalized = stripAll(normalized, EDITION_NAME_NOISE);

	// Remover espaços extras para evitar fragmentos
	return normalized.replace(/\s{2,}/g, " ").trim();
};

export const clearQuantity = (stringToSearch: string): string => {
	return stringToSearch.replace(/\bx\d+\b|\b\d+x\b/gi, "");
}


export const clearDLC = (stringToSearch: string): string => {
	// Combined regex pattern to match all DLC-related terms as whole words
	const dlcPattern = /\b(?:dlc|expansion|season|pass)\b/gi;

	// Remove all DLC-related terms in a single pass
	let normalizedString = stringToSearch.replace(dlcPattern, "");

	// Remove extra spaces and trim
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim();

	return normalizedString;
};


/**
 * Retorna o conjunto de categorias de edição CANÔNICAS presentes no nome (ex.:
 * "GOTY", "Game of the Year" e "G.O.T.Y" retornam todos `{"goty"}`). Usado para
 * garantir que os dois lados de uma comparação de preço se refiram à MESMA
 * edição — key base ≠ key de edição, pois têm preços diferentes. A palavra
 * "edition" sozinha é ignorada de propósito (não identifica um tier).
 */
export const hasEdition = (str: string): Set<string> => {
	const foundKeywords = new Set<string>();

	for (const tier of EDITION_TIERS) {
		if (tier.patterns.some((pattern) => pattern.test(str))) {
			foundKeywords.add(tier.category);
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

