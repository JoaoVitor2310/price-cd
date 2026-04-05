import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { clearDLC, clearEdition, clearString } from "@/helpers/clear-string.js";
import {
	STEAM_CHARTS_BASE_URL,
	STEAM_CHARTS_SEARCH_URL,
} from "@/helpers/constants.js";
import type { PopularityFetcher } from "@/application/games/ports/game-search.ports.js";
import type { FoundGames } from "@/application/games/game.types.js";

const processGame = async (
	gameString: string,
	originalIndex: number,
): Promise<FoundGames | null> => {
	try {
		console.log(
			`🔄 [INFO] Processing game ${originalIndex + 1}: ${gameString}`,
		);

		let gameStringClean: string = gameString;
		gameStringClean = clearEdition(gameStringClean);
		const params = new URLSearchParams({ q: gameStringClean });

		let response: AxiosResponse;
		try {
			response = await axios.get(
				`${STEAM_CHARTS_SEARCH_URL}?${params.toString()}`,
			);
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to search SteamCharts for "${gameString}"`);
			return null;
		}

		if (!response || !response.data) {
			console.error(
				`❌ [ERROR] Invalid response from SteamCharts for "${gameString}"`,
			);
			return null;
		}

		gameStringClean = clearDLC(gameStringClean);
		gameStringClean = clearString(gameStringClean);
		gameStringClean = gameStringClean.toLowerCase().trim();

		const $search = cheerio.load(response.data);
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

		try {
			response = await axios.get(`${STEAM_CHARTS_BASE_URL}${id_steam}`);
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to fetch game details for "${gameString}"`);
			return null;
		}

		if (!response || !response.data) {
			console.error(
				`❌ [ERROR] Invalid game details response for "${gameString}"`,
			);
			return null;
		}

		id_steam = id_steam.replace("/app/", "");

		const $details = cheerio.load(response.data);

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

		const popularity = Number.parseInt((popularity24hText as string).replace(/,/g, ""), 10);
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
		console.log("⚡ [INFO] minPopularity is 0, returning all games without popularity check");
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
	async fetch(gameNames: string[], minPopularity: number): Promise<FoundGames[]> {
		return searchSteamCharts(gameNames, minPopularity);
	}
}
