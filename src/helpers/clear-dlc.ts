export const clearDLC = (stringToSearch: string): string => {
	// Combined regex pattern to match all DLC-related terms as whole words
	const dlcPattern = /\b(?:dlc|expansion|season|pass)\b/gi;

	// Remove all DLC-related terms in a single pass
	let normalizedString = stringToSearch.replace(dlcPattern, "");

	// Remove extra spaces and trim
	normalizedString = normalizedString.replace(/\s{2,}/g, " ").trim();

	return normalizedString;
};
