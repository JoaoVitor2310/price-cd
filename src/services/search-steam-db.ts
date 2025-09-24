import dotenv from "dotenv";

dotenv.config();

import axios, { type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import { clearDLC } from "../helpers/clear-dlc.js";
import { clearEdition } from "../helpers/clear-edition.js";
import { clearString } from "../helpers/clear-string.js";
import type { foundGames } from "../types/foundGames.js";
import {
	STEAM_CHARTS_BASE_URL,
	STEAM_CHARTS_SEARCH_URL,
} from "../helpers/constants.js";

export const searchSteamDb = async (
	gamesToSearch: string[],
): Promise<foundGames[]> => {
	const foundGames: foundGames[] = [];
	for (const [index, gameString] of gamesToSearch.entries()) {
		let response: AxiosResponse | undefined;
		console.log(`gameString: ${gameString}`);

		let gameStringClean: string = gameString;
		gameStringClean = clearEdition(gameStringClean);
		const params = new URLSearchParams({ q: gameStringClean });

		try {
			response = await axios.get(
				`${STEAM_CHARTS_SEARCH_URL}?${params.toString()}`,
			);
		} catch (_error) {
			continue;
		}

		if (!response || !response.data) continue;

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

		let id: string = "";

		for (const link of links) {
			let gameName = clearString(link.text);
			gameName = clearDLC(gameName);
			gameName = clearEdition(gameName).trim().toLowerCase();
			gameName = gameName.trim().toLowerCase();

			if (gameName === gameStringClean) {
				id = link.href;
				break; // Finaliza o loop pois encontrou o elemento
			}
		}

		if (id === "") continue;

		try {
			response = await axios.get(`${STEAM_CHARTS_BASE_URL}${id}`);
		} catch (_error) {
			continue;
		}

		if (!response || !response.data) continue;

		const $details = cheerio.load(response.data);
		const spans: string[] = [];

		$details("span.num").each((_, element) => {
			const numText = $details(element).text().trim();
			if (numText) {
				spans.push(numText);
			}
		});

		if (spans.length < 1) continue;
		console.log(`popularity: ${Number.parseInt(spans[1], 10)}`);
		foundGames.push({
			id: index,
			name: gameString,
			popularity: Number.parseInt(spans[1], 10),
		});
	}

	return foundGames;
};
