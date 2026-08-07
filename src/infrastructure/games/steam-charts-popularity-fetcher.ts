import * as cheerio from "cheerio";
import type { FoundGames } from "@/application/games/game.types.js";
import type { PopularityFetcher } from "@/application/games/ports/game-search.ports.js";
import {
	clearDLC,
	clearEdition,
	clearQuantity,
	clearString,
} from "@/helpers/clear-string.js";
import {
	STEAM_CHARTS_BASE_URL,
	STEAM_CHARTS_SEARCH_URL,
} from "@/helpers/constants.js";

/**
 * Exceções pontuais onde o nome escrito pelo revendedor não bate com o
 * listing do SteamCharts, mas é o MESMO jogo em termos de popularidade — ex.:
 * "Prey 2017" existe pra distinguir do Prey de 2006 (mesmo caso do AllKeyShop
 * com "Skyrim Special Edition", ver docs/adr/0003-*), mas o SteamCharts só
 * lista o jogo como "Prey". Não é uma regra geral de remover ano/sufixo do
 * nome — só sabemos, caso a caso, que estas duas strings são o mesmo jogo.
 * Vale só pra esta etapa (popularidade); não afeta a busca de preço.
 */
const POPULARITY_NAME_ALIASES: Record<string, string> = {
	"prey 2017": "Prey",
};

// Exportado só pra teste alcançar direto — não faz parte da superfície pública
// deste módulo (o resto do app só importa `SteamChartsPopularityFetcher`).
export const resolvePopularitySearchName = (gameString: string): string => {
	return POPULARITY_NAME_ALIASES[gameString.trim().toLowerCase()] ?? gameString;
};

/**
 * Nome usado pra buscar/casar no SteamCharts: edição é removida ANTES do
 * apelido ser consultado — "Prey 2017 Deluxe" só bate com o apelido "Prey
 * 2017" depois que "Deluxe" já saiu, senão a busca por string exata do
 * apelido nunca casa. A popularidade é a mesma pra toda edição do mesmo jogo.
 */
export const normalizePopularitySearchName = (gameString: string): string => {
	let clean = clearEdition(gameString);
	clean = resolvePopularitySearchName(clean);
	clean = clearQuantity(clean);
	return clean;
};

const processGame = async (
	gameString: string,
	originalIndex: number,
): Promise<FoundGames | null> => {
	try {
		console.log(
			`🔄 [INFO] Processing game ${originalIndex + 1}: ${gameString}`,
		);

		let gameStringClean: string = normalizePopularitySearchName(gameString);
		const params = new URLSearchParams({ q: gameStringClean });

		let searchHtml: string;
		try {
			const searchRes = await fetch(
				`${STEAM_CHARTS_SEARCH_URL}?${params.toString()}`,
			);
			if (!searchRes.ok) {
				console.error(
					`❌ [ERROR] Failed to search SteamCharts for "${gameString}"`,
				);
				return null;
			}
			searchHtml = await searchRes.text();
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to search SteamCharts for "${gameString}"`,
			);
			return null;
		}

		gameStringClean = clearDLC(gameStringClean);
		gameStringClean = clearString(gameStringClean);
		gameStringClean = gameStringClean.toLowerCase().trim();

		const $search = cheerio.load(searchHtml);
		const links: { href: string; text: string }[] = [];

		$search("a").each((_, element) => {
			const href = $search(element).attr("href");
			const text = $search(element).text().trim();
			if (href && text) {
				links.push({ href, text });
			}
		});

		let id_steam: string = "";
		for (const link of links) {
			let gameName = clearString(link.text);
			gameName = clearDLC(gameName);
			gameName = clearEdition(gameName).trim().toLowerCase();
			gameName = gameName.trim().toLowerCase();

			if (gameName === gameStringClean) {
				id_steam = link.href;
				break;
			}
		}

		if (id_steam === "") {
			console.log(
				`⏭️ [INFO] No matching game found for "${gameString}", skipping`,
			);
			return null;
		}

		let detailsHtml: string;
		try {
			const detailsRes = await fetch(`${STEAM_CHARTS_BASE_URL}${id_steam}`);
			if (!detailsRes.ok) {
				console.error(
					`❌ [ERROR] Failed to fetch game details for "${gameString}"`,
				);
				return null;
			}
			detailsHtml = await detailsRes.text();
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to fetch game details for "${gameString}"`,
			);
			return null;
		}

		id_steam = id_steam.replace("/app/", "");

		const $details = cheerio.load(detailsHtml);

		let popularity24hText: string | null = null;
		$details("#app-heading .app-stat").each((_, el) => {
			if ($details(el).text().toLowerCase().includes("24-hour peak")) {
				popularity24hText = $details(el).find("span.num").text().trim();
			}
		});

		if (!popularity24hText) {
			console.log(
				`⚠️ [INFO] No popularity data found for "${gameString}", skipping`,
			);
			return null;
		}

		const popularity = Number.parseInt(
			(popularity24hText as string).replace(/,/g, ""),
			10,
		);
		console.log(
			`👥 [INFO] Found popularity: ${popularity} for "${gameString}"`,
		);

		return {
			id: originalIndex,
			name: gameString,
			popularity,
			id_steam,
		};
	} catch (error) {
		console.error(
			`❌ [ERROR] Unexpected error processing game "${gameString}":`,
			error,
		);
		return null;
	}
};

const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
};

const searchSteamCharts = async (
	gamesToSearch: string[],
	minPopularity: number,
	batchSize: number = 50,
): Promise<FoundGames[]> => {
	console.log("\n📊 [INFO] Starting SteamCharts popularity search");
	console.log(
		`📋 [INFO] Processing ${gamesToSearch.length} games in batches of ${batchSize}`,
	);

	if (minPopularity === 0) {
		console.log(
			"⚡ [INFO] minPopularity is 0, returning all games without popularity check",
		);
		return gamesToSearch.map((gameName, index) => ({
			id: index,
			name: gameName,
			popularity: 0,
		}));
	}

	const foundGames: FoundGames[] = [];
	const gameBatches = chunkArray(gamesToSearch, batchSize);

	for (let batchIndex = 0; batchIndex < gameBatches.length; batchIndex++) {
		const batch = gameBatches[batchIndex];
		const globalIndexOffset = batchIndex * batchSize;

		const batchResults = await Promise.all(
			batch.map((gameString, localIndex) =>
				processGame(gameString, globalIndexOffset + localIndex),
			),
		);

		const validResults = batchResults.filter(
			(result): result is FoundGames => result !== null,
		);
		foundGames.push(...validResults);

		console.log(
			`✅ [INFO] Completed batch ${batchIndex + 1}/${gameBatches.length} - found ${validResults.length}/${batch.length} games`,
		);
	}

	console.log(
		`✅ [INFO] Completed SteamCharts search - found popularity for ${foundGames.length}/${gamesToSearch.length} games`,
	);
	return foundGames;
};

export class SteamChartsPopularityFetcher implements PopularityFetcher {
	async fetch(
		gameNames: string[],
		minPopularity: number,
	): Promise<FoundGames[]> {
		return searchSteamCharts(gameNames, minPopularity);
	}
}
