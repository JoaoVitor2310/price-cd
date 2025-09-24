import { clearDLC } from "@/helpers/clear-dlc";
import { clearEdition } from "@/helpers/clear-edition";
import { clearString } from "@/helpers/clear-string";
import { GAMIVO_SEARCH_URL } from "@/helpers/constants";
import { hasEdition } from "@/helpers/has-edition";
import type { foundGames } from "@/types/foundGames";
import axios, { type AxiosResponse } from "axios";
import dotenv from "dotenv";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { connect } from "puppeteer-real-browser";

dotenv.config();

const apiGamivoUrl = process.env.apiGamivoUrl;
const timeOut = Number(process.env.timeOut) || 3000;

puppeteer.use(StealthPlugin());

export const searchGamivo = async (
	gamesToSearch: foundGames[],
): Promise<foundGames[]> => {
	let productSlug = "";
	const foundGames: foundGames[] = [];

	let response: AxiosResponse;

	const { browser, page } = await connect({
		headless: false,

		args: [],

		customConfig: {},

		turnstile: true,

		connectOption: {},

		disableXvfb: false,
		ignoreAllFlags: false,
	});

	await page.setViewport({
		width: 426,
		height: 240,
	});

	for (const [index, game] of gamesToSearch.entries()) {
		console.log(`Índice: ${index}, Jogo:`, game.name);
		const searchString = encodeURIComponent(game.name).replace(
			/%E2%84%A2/g,
			"",
		); // Remove "™"

		try {
			await page.goto(`${GAMIVO_SEARCH_URL}/${searchString}`);

			await page
				.waitForSelector(".search-results__tiles", { timeout: timeOut })
				.catch(async (_error) => {
					console.log(
						"A página foi redirecionada após o CAPTCHA. Tentando navegar novamente.",
					);

					// Verifique a URL após o erro de seletor
					const _currentUrl = page.url();

					// await new Promise(resolve => setTimeout(resolve, 20000));

					// const newPage = await context.newPage();
					await page.goto(`${GAMIVO_SEARCH_URL}/${searchString}`);
					await page.waitForSelector(".search-results__tiles", {
						timeout: timeOut,
					});
				});

			const resultados = await page.$$(".product-tile__name");

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
				// Verifica se o texto do jogo contém a palavra "Steam"
				if (gameNameClean.includes(gameStringClean)) {
					// console.log(gameNameClean);
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
						// Clica no resultado

						// if (regex.test(gameNameClean)) {
						// console.log("gameNameClean certo: " + gameNameClean);

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
						console.log(productSlug);

						// break; // Encerra o loop depois de clicar em um resultado
					}
				}
			}

			if (productSlug === "") continue;

			try {
				response = await axios.get(
					`${apiGamivoUrl}/api/products/priceResearcher/${productSlug}`,
				);
				const precoGamivo: number = response.data.menorPreco;
				const precoFormatado: string = precoGamivo.toString().replace(".", ",");
				console.log(`precoGamivo: ${precoFormatado}`);

				foundGames.push({
					id: index,
					name: game.name,
					popularity: game.popularity,
					GamivoPrice: precoFormatado,
				});
			} catch (error) {
				console.log(error);
				console.log("API Gamivo desligada ou arquivo env faltando");
			}
		} catch (_error) {
			console.log("não achou");
		} finally {
			// if (browser) {
			//     const pages = await browser.pages();
			//     // @ts-expect-error
			//     if (pages) await Promise.all(pages.map((page) => page.close()));
			//     const childProcess = browser.process()
			//     if (childProcess) {
			//         childProcess.kill()
			//     }
			//     await browser.close();
			//     // @ts-expect-error
			//     if (browser && browser.process()) browser.process().kill('SIGINT');
			// }
		}
	}

	const pages = await browser.pages();
	if (pages) await Promise.all(pages.map((page) => page.close()));

	const childProcess = browser.process();
	if (childProcess) {
		childProcess.kill();
	}

	await browser.close();

	if (browser?.process()) browser.process()?.kill("SIGINT");

	return foundGames;
};
