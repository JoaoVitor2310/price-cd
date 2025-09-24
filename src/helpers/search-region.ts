const dlcRegex = /\bdlc\b/gi;
const expansionRegex = /\bexpansion\b/gi;

const searchRegion = (stringToSearch: string) => {
	// Pesquisar por região

	// Remover todas as ocorrências de "dlc" ou "DLC"
	let normalizedString = stringToSearch
		.replace(dlcRegex, "")
		.replace(expansionRegex, "");

	// Remover espaços extras para evitar fragmentos
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim(); // Normaliza a string para remover múltiplos espaços

	return normalizedString;
};

export default searchRegion;
