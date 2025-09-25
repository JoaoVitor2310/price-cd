import axios, { type AxiosResponse } from "axios";
import dotenv from "dotenv";
import { clearDLC } from "@/helpers/clear-dlc";
import { clearEdition } from "@/helpers/clear-edition";
import { clearString } from "@/helpers/clear-string";
import { GAMIVO_SEARCH_URL } from "@/helpers/constants";
import { hasEdition } from "@/helpers/has-edition";
import { cleanupBrowser, initializeBrowser } from "@/lib/puppeteer-browser";
import type { FoundGames } from "@/types/foundGames";

dotenv.config();

const apiGamivoUrl = process.env.apiGamivoUrl;
const timeOut = Number(process.env.timeOut) || 3000;

export const searchGamivo = async (
	gamesToSearch: FoundGames[],
): Promise<FoundGames[]> => {
	console.log("\n🎮 [INFO] Starting Gamivo price search");
	console.log(`📋 [INFO] Processing ${gamesToSearch.length} games`);

	let productSlug = "";
	const foundGames: FoundGames[] = [];

	let response: AxiosResponse;

	const { browser, page } = await initializeBrowser();

	for (const [index, game] of gamesToSearch.entries()) {
		console.log(
			`\n🔄 [INFO] Processing game ${index + 1}/${gamesToSearch.length}: ${game.name}`,
		);
		const searchString = encodeURIComponent(game.name).replace(
			/%E2%84%A2/g,
			"",
		); // Remove "™"

		try {
			console.log(`🔍 [INFO] Searching Gamivo for: ${game.name}`);
			await page.goto(`${GAMIVO_SEARCH_URL}/${searchString}`);

			await page
				.locator(".search-results__tiles")
				.wait()
				.catch(async (error) => {
					console.log(
						"⚠️ [WARN] Page load timeout or selector not found",
						error,
					);
					await page.goto(`${GAMIVO_SEARCH_URL}/${searchString}`);
					await page.waitForSelector(".search-results__tiles", {
						timeout: timeOut,
					});
				});

			const resultados = await page.$$(".product-tile__name");
			console.log(`📝 [INFO] Found ${resultados.length} potential matches`);

			const gameString = game.name;
			let gameStringClean = clearEdition(gameString);
			gameStringClean = clearString(gameStringClean);
			gameStringClean = clearDLC(gameStringClean);
			gameStringClean = gameStringClean.toLowerCase().trim();

			for (const resultado of resultados) {
				const gameName = await resultado.$eval(
					"span.ng-star-inserted",
					(element) => element.textContent || "",
				);

				let gameNameClean = clearEdition(gameName);
				gameNameClean = clearString(gameNameClean);
				gameNameClean = clearDLC(gameNameClean);
				gameNameClean = gameNameClean.toLowerCase().trim();
				if (gameNameClean.includes(gameStringClean)) {
					console.log(`🎯 [INFO] Checking match: ${gameNameClean}`);
					const regex = new RegExp(
						`^${gameStringClean}\\s*(?!2\\s)([a-z]{2}(?:/[a-z]{2})*)?\\sGlobal(?:\\ssteam)?$`,
						"i",
					);

					const regex2 = new RegExp(
						`^${gameStringClean}\\s*Global Steam$`,
						"i",
					);

					const regex3 = new RegExp(`^${gameStringClean}\\sROW\\sSteam$`, "i");

					if (
						regex.test(gameNameClean) ||
						regex2.test(gameNameClean) ||
						regex3.test(gameNameClean)
					) {
						const gameStringKeywords = hasEdition(gameString);
						const gameNameKeywords = hasEdition(gameName);

						// Se um dos conjuntos tiver palavras-'edition' que o outro não tem, faz "continue"
						if (
							![...gameStringKeywords].every((keyword) =>
								gameNameKeywords.has(keyword),
							) ||
							![...gameNameKeywords].every((keyword) =>
								gameStringKeywords.has(keyword),
							)
						) {
							continue;
						}

						const elementoLink = await resultado.$("a");
						if (!elementoLink) continue;

						const href = await (
							await elementoLink.getProperty("href")
						).jsonValue();

						const startIndex = href.indexOf("/product/") + "/product/".length;
						productSlug = href.substring(startIndex);
						console.log("✨ [INFO] Found matching product:", gameNameClean);
					}
				}
			}

			if (productSlug === "") {
				console.log("⏭️ [INFO] No matching product found, skipping game");
				continue;
			}

			try {
				console.log("💰 [INFO] Fetching price from Gamivo API");
				response = await axios.get(
					`${apiGamivoUrl}/api/products/priceResearcher/${productSlug}`,
				);
				const precoGamivo: number = response.data.menorPreco;
				const precoFormatado: string = precoGamivo.toString().replace(".", ",");
				console.log(`💵 [INFO] Found price: ${precoFormatado}`);

				foundGames.push({
					id: index,
					name: game.name,
					popularity: game.popularity,
					GamivoPrice: precoFormatado,
				});
			} catch (error) {
				console.error("❌ [ERROR] Failed to fetch Gamivo price:", error);
			}
		} catch (error) {
			console.error("❌ [ERROR] Failed to process game search", error);
		}
	}

	console.log("\n🧹 [INFO] Cleaning up browser resources");
	await cleanupBrowser(browser);

	console.log(
		`✅ [INFO] Completed Gamivo search - found prices for ${foundGames.length}/${gamesToSearch.length} games`,
	);
	return foundGames;
};
