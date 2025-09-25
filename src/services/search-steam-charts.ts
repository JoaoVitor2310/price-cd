import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { clearDLC } from "@/helpers/clear-dlc";
import { clearEdition } from "@/helpers/clear-edition";
import { clearString } from "@/helpers/clear-string";
import {
	STEAM_CHARTS_BASE_URL,
	STEAM_CHARTS_SEARCH_URL,
} from "@/helpers/constants";
import type { FoundGames } from "@/types/foundGames";

/**
 * Processes a single game to find its popularity data on SteamCharts
 * @param gameString - The game name to search for
 * @param originalIndex - The original index of the game in the input array
 * @returns Promise<FoundGames | null> - The found game data or null if not found/error
 */
const processGame = async (
	gameString: string,
	originalIndex: number,
): Promise<FoundGames | null> => {
	try {
		console.log(
			`\n🔄 [INFO] Processing game ${originalIndex + 1}: ${gameString}`,
		);

		let gameStringClean: string = gameString;
		gameStringClean = clearEdition(gameStringClean);
		const params = new URLSearchParams({ q: gameStringClean });

		let response: AxiosResponse;
		try {
			console.log("🔍 [INFO] Searching SteamCharts");
			response = await axios.get(
				`${STEAM_CHARTS_SEARCH_URL}?${params.toString()}`,
			);
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to search SteamCharts for "${gameString}"`,
				error,
			);
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

		console.log(
			`📝 [INFO] Found ${links.length} potential matches for "${gameString}"`,
		);

		let id: string = "";
		for (const link of links) {
			let gameName = clearString(link.text);
			gameName = clearDLC(gameName);
			gameName = clearEdition(gameName).trim().toLowerCase();
			gameName = gameName.trim().toLowerCase();

			if (gameName === gameStringClean) {
				id = link.href;
				console.log(`🎯 [INFO] Found matching game page for "${gameString}"`);
				break;
			}
		}

		if (id === "") {
			console.log(
				`⏭️ [INFO] No matching game found for "${gameString}", skipping`,
			);
			return null;
		}

		try {
			console.log(`📥 [INFO] Fetching game details for "${gameString}"`);
			response = await axios.get(`${STEAM_CHARTS_BASE_URL}${id}`);
		} catch (error) {
			console.error(
				`❌ [ERROR] Failed to fetch game details for "${gameString}"`,
				error,
			);
			return null;
		}

		if (!response || !response.data) {
			console.error(
				`❌ [ERROR] Invalid game details response for "${gameString}"`,
			);
			return null;
		}

		const $details = cheerio.load(response.data);
		const spans: string[] = [];

		$details("span.num").each((_, element) => {
			const numText = $details(element).text().trim();
			if (numText) {
				spans.push(numText);
			}
		});

		if (spans.length < 1) {
			console.log(
				`⚠️ [INFO] No popularity data found for "${gameString}", skipping`,
			);
			return null;
		}

		const popularity = Number.parseInt(spans[1], 10);
		console.log(
			`👥 [INFO] Found popularity: ${popularity} for "${gameString}"`,
		);

		return {
			id: originalIndex,
			name: gameString,
			popularity,
		};
	} catch (error) {
		console.error(
			`❌ [ERROR] Unexpected error processing game "${gameString}":`,
			error,
		);
		return null;
	}
};

/**
 * Splits an array into chunks of specified size
 * @param array - The array to split
 * @param chunkSize - The size of each chunk
 * @returns Array of chunks
 */
const chunkArray = <T>(array: T[], chunkSize: number): T[][] => {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}
	return chunks;
};

export const searchSteamCharts = async (
	gamesToSearch: string[],
	batchSize: number = 5,
): Promise<FoundGames[]> => {
	console.log("\n📊 [INFO] Starting SteamCharts popularity search");
	console.log(
		`📋 [INFO] Processing ${gamesToSearch.length} games in batches of ${batchSize}`,
	);

	const foundGames: FoundGames[] = [];

	// Split games into batches
	const gameBatches = chunkArray(gamesToSearch, batchSize);

	for (let batchIndex = 0; batchIndex < gameBatches.length; batchIndex++) {
		const batch = gameBatches[batchIndex];
		console.log(
			`\n🔄 [INFO] Processing batch ${batchIndex + 1}/${gameBatches.length} (${batch.length} games)`,
		);

		// Calculate global indices for this batch
		const globalIndexOffset = batchIndex * batchSize;

		// Process all games in the current batch in parallel
		const batchResults = await Promise.all(
			batch.map((gameString, localIndex) =>
				processGame(gameString, globalIndexOffset + localIndex),
			),
		);

		// Filter out null results and add to foundGames
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
