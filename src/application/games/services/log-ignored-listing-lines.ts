import type { HaveListing } from "@/domain/lists/have-listing.js";

/**
 * O que a pesquisa (`priceResearchGames`) tirou da lista antes de rodar o motor, para nada sumir sem
 * rastro entre o pedido e o resultado: cabeçalhos de seção (não são jogos) e as
 * seções de plataforma que o price-cd ainda não sabe precificar.
 */
export const logIgnoredListingLines = (
	listing: Pick<HaveListing, "headers" | "skippedSections">,
): void => {
	for (const header of listing.headers) {
		console.log(
			`⏭️ [INFO] "${header}" is a section header, not a game — ignored.`,
		);
	}
	for (const section of listing.skippedSections) {
		console.log(
			`⏭️ [INFO] ${section.games.length} game(s) under "${section.platform}" ignored — that platform cannot be priced yet.`,
		);
	}
};
