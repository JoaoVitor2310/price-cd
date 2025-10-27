// biome-ignore assist/source/organizeImports: <explanation>
import axios, { AxiosError, type AxiosResponse } from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { clearString, clearEdition, hasEdition, getRegion } from "@/helpers/clear-string.js";
import { ALLKEYSHOP_SEARCH_FILTERS, ALLKEYSHOP_SEARCH_URL } from "@/helpers/constants.js";
import { cleanupBrowser, initializeBrowser } from "@/lib/puppeteer-browser.js";
import type { FoundGames, GameData, Price } from "@/types/games.js";
import { delay } from "@/helpers/utils.js";
import { TimeoutError } from "puppeteer";
import { PageWithCursor } from "puppeteer-real-browser";

dotenv.config();

const scrapSearchResults = (html: string): { link: string; name: string; price: string }[] => {
    const $ = cheerio.load(html);

    const links = $('a.absolute').map((_, el) => $(el).attr('href') || '').get();
    const names = $('p.text-md.text-white').map((_, el) => $(el).text().trim()).get();
    const prices = $('a.price-skew span').map((_, el) => $(el).text().trim()).get();

    // Garante que todos os arrays tenham o mesmo tamanho
    const length = Math.min(links.length, names.length, prices.length);

    const searchResults: { link: string; name: string; price: string }[] = [];
    for (let i = 0; i < length; i++) {
        searchResults.push({
            link: links[i],
            name: names[i],
            price: prices[i].toString().replace("€", "").replace(".", ","),
        });
    }

    return searchResults;
}

const scrapGamePage = (html: string): GameData | null => {
    const $ = cheerio.load(html);

    // Pega o conteúdo do script que contém "gamePageTrans"
    const scriptContent = $('script#aks-offers-js-extra').html();

    if (!scriptContent) return null;

    // Expressão regular para capturar o JSON dentro de var gamePageTrans = {...};
    const match = scriptContent.match(/var\s+gamePageTrans\s*=\s*(\{[\s\S]*?\});/);

    if (!match) return null;

    try {
        const jsonString = match[1];
        const json = JSON.parse(jsonString);
        return json;
    } catch (err) {
        console.error('Erro ao fazer parse do JSON:', err);
        return null;
    }
}

const detectOfferTooLow = (regionPrices: Price[]) => {
    if (regionPrices.length === 0) return null;

    let bestOffer: Price | null = null;
    let secondBestOffer: Price | null = null;

    for (const offer of regionPrices) {
        if (!bestOffer || offer.originalPrice < bestOffer.originalPrice) {
            secondBestOffer = bestOffer;
            bestOffer = offer;
        } else if (!secondBestOffer || offer.originalPrice < secondBestOffer.originalPrice) {
            secondBestOffer = offer;
        }
    }

    if (!bestOffer) return null;

    const bestOfferPrice = bestOffer.originalPrice;

    if (!secondBestOffer) return bestOfferPrice;


    const secondBestOfferPrice = secondBestOffer.originalPrice;
    const difference = secondBestOfferPrice - bestOfferPrice;

    const percentualDifference =
        secondBestOfferPrice > 1
            ? 0.1 * secondBestOfferPrice
            : 0.05 * secondBestOfferPrice;


    if (difference >= percentualDifference) {
        return secondBestOfferPrice;
    }

    return bestOfferPrice;

}

const bestOfferPrice = (data: GameData, region: string): string | null => {
    const { prices, regions } = data;

    const filterNameDictionary: Record<string, string> = {
        global: "STEAM GLOBAL",
        eu: "STEAM EU",
        row: "STEAM ROW",
    };

    const filterName = filterNameDictionary[region];

    const regionKey = Object.keys(regions).find(
        key => regions[key].filter_name.toUpperCase() === filterName.toUpperCase()
    );

    if (!regionKey) {
        console.log(`❌ [ERROR] Region not found.`);
        return null;
    }

    const regionPrices = prices.filter(p => String(p.region) === regionKey);

    if (regionPrices.length === 0) {
        console.log(`❌ [ERROR] No prices found for the region.`);
        return null;
    }

    const bestOffer = detectOfferTooLow(regionPrices);
    if (bestOffer == null) return null;

    return bestOffer.toString().replace(".", ",");
}

/**
 * Faz uma requisição GET com retry automático em caso de 429 (Too Many Requests)
 * 
 * @param url URL do recurso
 * @param maxRetries Max attempts (padrão: 3)
 * @param baseDelay Tempo base de espera (em ms) para o backoff exponencial (padrão: 5000ms)
 * @returns AxiosResponse with response data 
 */
export async function fetchWithRetry<T = any>(
    url: string,
    maxRetries: number = 3,
    baseDelay: number = 5000
): Promise<AxiosResponse<T>> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await axios.get<T>(url);
            return response;
        } catch (error: any) {
            if (axios.isAxiosError(error) && error.response) {
                const { status, headers, statusText } = error.response;

                if (status === 429) {
                    const retryAfterHeader = headers["retry-after"];
                    const retryAfterSeconds = retryAfterHeader
                        ? parseInt(retryAfterHeader, 10)
                        : Math.pow(2, attempt - 1) * (baseDelay / 1000);

                    console.log(
                        `⚠️ [INFO] Too many requests(fetch). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`
                    );

                    await delay(retryAfterSeconds * 1000);
                } else {
                    console.error(
                        `⚠️ [INFO] Service Unavailable. Attempt ${attempt}/${maxRetries}. Retrying in 1.5s...`
                    );
                    await delay(1500);
                }
            } else {
                console.error(`❌ [ERROR] Unknown error while fetching page:`, error);
                throw error;
            }
        }
    }

    throw new Error(`❌ [ERROR] Failed after ${maxRetries} attempts: ${url}`);
}

/**
 * Go to page with automatic retry if timeouts or status 429
 * 
 * @param page Puppeteer Page instance used for navigation
 * @param maxRetries Max attempts (standard: 3)
 * @returns AxiosResponse with response data 
 */
async function gotoWithRetry(page: PageWithCursor, url: string, maxRetries = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 20000,
            });

            const status = response?.status();

            if (status === 429) {
                const retryAfterHeader = response?.headers()['retry-after'];
                const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;

                console.warn(`⚠️ [INFO] Too many requests(puppeteer). Attempt ${attempt}/${maxRetries}. Retrying in ${retryAfterSeconds}s...`);
                
                await delay(retryAfterSeconds * 1000);
                continue;
            }

            return true;
        } catch (error) {
            if (error instanceof TimeoutError) {
                console.warn(
                    `⚠️ [INFO] Timeout trying to navigate to ${url}. Attempt ${attempt}/${maxRetries}`
                );
                if (attempt < maxRetries) {
                    await delay(3000);
                    continue;
                }
            }

            console.error(`❌ [ERROR] Failed to navigate to ${url}, error:`, error);
            return false;
        }
    }

    return false;
}


/**
 * Go to page with automatic retry if timeouts or status 429
 * 
 * @param gamesToSearch Array of games to search for prices on AllKeyShop
 * @returns FoundGames with prices 
 */
export const searchAllKeyShop = async (
    gamesToSearch: FoundGames[],
): Promise<FoundGames[]> => {
    console.log(
        `📋 [INFO] Processing ${gamesToSearch.length} AllKeyShop price search games`,
    );

    const foundGames: FoundGames[] = [];

    const { browser, page } = await initializeBrowser();

    for (const [index, game] of gamesToSearch.entries()) {
        console.log(`🔍 [INFO] Searching AllKeyShop ${index + 1} for: ${game.name}`);
        const searchString = new URLSearchParams({ search_name: game.name });

        const browseURL = await gotoWithRetry(page, `${ALLKEYSHOP_SEARCH_URL}${searchString}${ALLKEYSHOP_SEARCH_FILTERS}`);
        if (!browseURL) continue;

        await page.waitForSelector('p.text-md.text-white', { timeout: 10000 });
        
        const htmlSearchPage = await page.content();
        
        const searchResults = scrapSearchResults(htmlSearchPage);
        
        const gameString = game.name;

        let gamePage: string = "";
        let foundName: string = "";

        let gameStringClean = clearEdition(gameString);
        gameStringClean = clearString(gameStringClean);
        gameStringClean = gameStringClean.toLowerCase().trim();

        for (const searchResult of searchResults) {
            let searchResultClean = clearEdition(searchResult.name);
            searchResultClean = clearString(searchResultClean);
            searchResultClean = searchResultClean.toLowerCase().trim();


            const gameStringKeywords = hasEdition(gameString);
            const searchResultKeywords = hasEdition(searchResult.name);

            // Se um dos conjuntos tiver palavras-'edition' que o outro não tem, continue
            if (
                ![...gameStringKeywords].every((keyword) =>
                    searchResultKeywords.has(keyword),
                ) ||
                ![...searchResultKeywords].every((keyword) =>
                    gameStringKeywords.has(keyword),
                )
            ) {
                continue;
            }

            if (searchResultClean === gameStringClean) {
                gamePage = searchResult.link;
                foundName = searchResult.name
                break;
            }
        }

        if (gamePage === "") {
            console.log(`⚠️ [INFO] Game not found. Skipping to the next game.`);
            continue;
        }

        let responseGamePage: AxiosResponse;

        try {
            responseGamePage = await fetchWithRetry(gamePage);
        } catch (_error) {
            continue;
        }

        if (responseGamePage.status !== 200) {
            continue;
        }

        const gamePageData = scrapGamePage(responseGamePage.data);
        if (!gamePageData) continue;

        const region = getRegion(game.name);

        const price = bestOfferPrice(gamePageData, region);
        if (!price) continue;

        foundGames.push({
            id: index,
            name: game.name,
            foundName: foundName,
            popularity: game.popularity,
            GamivoPrice: price,
        });

        console.log(`🔍 [INFO] Price found: ${price}`);
    }

    console.log("\n🧹 [INFO] Cleaning up browser resources");
    await cleanupBrowser(browser);

    console.log(
        `✅ [INFO] Completed AllKeyShop search - found prices for ${foundGames.length}/${gamesToSearch.length} games`,
    );
    return foundGames;
};
