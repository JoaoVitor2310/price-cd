import dotenv from "dotenv";

dotenv.config();

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

export const searchSteamCharts = async (
	gamesToSearch: string[],
): Promise<FoundGames[]> => {
	console.log("\n📊 [INFO] Starting SteamCharts popularity search");
	console.log(`📋 [INFO] Processing ${gamesToSearch.length} games`);

	const foundGames: FoundGames[] = [];
	for (const [index, gameString] of gamesToSearch.entries()) {
		let response: AxiosResponse | undefined;
		console.log(
			`\n🔄 [INFO] Processing game ${index + 1}/${gamesToSearch.length}: ${gameString}`,
		);

		let gameStringClean: string = gameString;
		gameStringClean = clearEdition(gameStringClean);
		const params = new URLSearchParams({ q: gameStringClean });

		try {
			console.log("🔍 [INFO] Searching SteamCharts");
			response = await axios.get(
				`${STEAM_CHARTS_SEARCH_URL}?${params.toString()}`,
			);
		} catch (error) {
			console.error("❌ [ERROR] Failed to search SteamCharts", error);
			continue;
		}

		if (!response || !response.data) {
			console.error("❌ [ERROR] Invalid response from SteamCharts");
			continue;
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

		console.log(`📝 [INFO] Found ${links.length} potential matches`);

		let id: string = "";
		for (const link of links) {
			let gameName = clearString(link.text);
			gameName = clearDLC(gameName);
			gameName = clearEdition(gameName).trim().toLowerCase();
			gameName = gameName.trim().toLowerCase();

			if (gameName === gameStringClean) {
				id = link.href;
				console.log("🎯 [INFO] Found matching game page");
				break;
			}
		}

		if (id === "") {
			console.log("⏭️ [INFO] No matching game found, skipping");
			continue;
		}

		try {
			console.log("📥 [INFO] Fetching game details");
			response = await axios.get(`${STEAM_CHARTS_BASE_URL}${id}`);
		} catch (_error) {
			console.error("❌ [ERROR] Failed to fetch game details");
			continue;
		}

		if (!response || !response.data) {
			console.error("❌ [ERROR] Invalid game details response");
			continue;
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
			console.log("⚠️ [INFO] No popularity data found, skipping");
			continue;
		}

		const popularity = Number.parseInt(spans[1], 10);
		console.log(`👥 [INFO] Found popularity: ${popularity}`);

		foundGames.push({
			id: index,
			name: gameString,
			popularity,
		});
	}

	console.log(
		`✅ [INFO] Completed SteamCharts search - found popularity for ${foundGames.length}/${gamesToSearch.length} games`,
	);
	return foundGames;
};
