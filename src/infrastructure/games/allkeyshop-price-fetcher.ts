import * as cheerio from "cheerio";
import dotenv from "dotenv";
import { clearString, clearEdition, hasEdition, getRegion, removeRegion, clearQuantity } from "@/helpers/clear-string.js";
import { ALLKEYSHOP_BASE_URL, ALLKEYSHOP_SEARCH_FILTERS, ALLKEYSHOP_SEARCH_URL, GAMIVO_API_PRODUCT_BY_SLUG_URL } from "@/helpers/constants.js";
import { enqueueWithBrowser, getSharedSession, invalidateSharedSession } from "@/lib/puppeteer-browser.js";
import { bestOfferPrice, findGamivoOffer, GAMIVO_MERCHANT_NAME } from "@/domain/games/pricing-rules.js";
import type { OfferPrice } from "@/domain/games/pricing-rules.js";
import { scrapSearchResults, scrapGamePage, extractGamivoSlug } from "@/infrastructure/games/allkeyshop-html-parser.js";
import type { SearchResult } from "@/infrastructure/games/allkeyshop-html-parser.js";
import type { PriceFetcher } from "@/application/games/ports/game-search.ports.js";
import type { FoundGames } from "@/application/games/game.types.js";
import type { Merchants, Price, Regions } from "@/infrastructure/games/allkeyshop.types.js";
import { fetchWithRetry } from "@/lib/fetch-with-retry.js";
import { gotoWithRetry } from "@/lib/puppeteer-goto-with-retry.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Private (module-internal only — not exported, not reachable from outside
// this file, equivalent to a PHP `private` method)
// ---------------------------------------------------------------------------

const ALLKEYSHOP_REDIRECTION_URL = "https://www.allkeyshop.com/redirection/offer/eur";

const REGION_FILTER_DICTIONARY: Record<string, string> = {
    global: "STEAM GLOBAL",
    eu: "STEAM EU",
    row: "STEAM ROW",
} as const;

const findRegionKey = (regions: Regions, region: string): string | null => {
    const filterName = REGION_FILTER_DICTIONARY[region];
    return Object.keys(regions).find(
        key => regions[key].filter_name.toUpperCase() === filterName?.toUpperCase()
    ) ?? null;
};

const findGamivoMerchantKey = (merchants: Merchants): string | null => {
    return Object.keys(merchants).find(key => merchants[key].name === GAMIVO_MERCHANT_NAME) ?? null;
};

const normalizeForMatching = (name: string): string => {
    let clean = clearEdition(name);
    clean = clearString(clean);
    clean = clearQuantity(clean);
    return clean.toLowerCase().trim();
};

// ---------------------------------------------------------------------------
// Exported only so tests can reach them directly — not part of this module's
// real public surface. The only thing other files in the app import from
// here is `AllKeyShopPriceFetcher`, at the bottom of this file.
// ---------------------------------------------------------------------------

type NormalizedOffer = Omit<Price, "merchant"> & OfferPrice;

export const toOfferPrices = (prices: Price[], regionKey: string, gamivoMerchantKey: string | null): NormalizedOffer[] => {
    return prices
        .filter(p => String(p.region) === regionKey)
        .map(p => ({
            ...p,
            merchant: gamivoMerchantKey != null && Number(p.merchant) === Number(gamivoMerchantKey)
                ? GAMIVO_MERCHANT_NAME
                : String(p.merchant),
        }));
};

export const matchSearchResult = (gameName: string, searchResults: SearchResult[]): { link: string; name: string } | null => {
    const gameNameClean = normalizeForMatching(gameName);
    const gameNameKeywords = hasEdition(gameName);

    for (const searchResult of searchResults) {
        const searchResultKeywords = hasEdition(searchResult.name);

        const editionMismatch =
            ![...gameNameKeywords].every((keyword) => searchResultKeywords.has(keyword)) ||
            ![...searchResultKeywords].every((keyword) => gameNameKeywords.has(keyword));

        if (editionMismatch) continue;

        if (normalizeForMatching(searchResult.name) === gameNameClean) {
            return { link: searchResult.link, name: searchResult.name };
        }
    }

    return null;
};

export const fetchGamivoSlug = async (offerId: number): Promise<string | null> => {
    try {
        const html = await fetchWithRetry(`${ALLKEYSHOP_REDIRECTION_URL}/${offerId}?locale=en&merchant=218`);
        return extractGamivoSlug(html);
    } catch {
        return null;
    }
};

export const fetchGamivoIdBySlug = async (slug: string): Promise<string | null> => {
    try {
        const response = await fetch(`${GAMIVO_API_PRODUCT_BY_SLUG_URL}/${slug}`, {
            headers: { Authorization: `Bearer ${process.env.API_KEY_GAMIVO}` },
        });

        if (!response.ok) {
            console.error(`❌ [ERROR] Gamivo API returned ${response.status} for slug "${slug}"`);
            return null;
        }

        const data = await response.json();
        return data?.id != null ? String(data.id) : null;
    } catch (error) {
        console.error(`❌ [ERROR] Failed to fetch Gamivo id for slug "${slug}":`, error);
        return null;
    }
};

// ---------------------------------------------------------------------------
// Public API — the orchestration and the adapter that other modules
// (controllers, services) actually import and depend on.
// ---------------------------------------------------------------------------

const searchAllKeyShop = async (
    gamesToSearch: FoundGames[],
    checkGamivoOffer: boolean,
): Promise<FoundGames[]> => {
    console.log(
        `📋 [INFO] Processing ${gamesToSearch.length} AllKeyShop price search games`,
    );

    return enqueueWithBrowser(async () => {
        const foundGames: FoundGames[] = [];

        const { page } = await getSharedSession();

        try {
            for (const [index, game] of gamesToSearch.entries()) {
                console.log(`🔍 [INFO] Searching AllKeyShop ${index + 1} for: ${game.name}`);

                let searchString = game.name;
                searchString = clearQuantity(searchString);
                searchString = new URLSearchParams({ search_name: searchString }).toString();

                const browseURL = await gotoWithRetry(page, `${ALLKEYSHOP_SEARCH_URL}${searchString}${ALLKEYSHOP_SEARCH_FILTERS}`);
                if (!browseURL) continue;

                const initialHtml = await page.content();
                const $initial = cheerio.load(initialHtml);
                if ($initial('div').filter((_, el) => $initial(el).text().trim() === "Sorry, there aren't any results matching your search criteria.").length > 0) {
                    console.log(`⚠️ [INFO] No results found on AllKeyShop for "${game.name}". Skipping.`);
                    continue;
                }

                try {
                    await page.waitForSelector('p.text-md.text-white', { timeout: 10000 });
                } catch (error) {
                    console.log(`⚠️ [INFO] Timeout waiting for selector for "${game.name}". Skipping to the next game.`);
                    continue;
                }

                const htmlSearchPage = await page.content();
                const searchResults = scrapSearchResults(htmlSearchPage);

                const match = matchSearchResult(game.name, searchResults);
                if (!match) {
                    console.log(`⚠️ [INFO] Game not found. Skipping to the next game.`);
                    continue;
                }

                const gamePageUrl = match.link.startsWith("http") ? match.link : `${ALLKEYSHOP_BASE_URL}${match.link}`;

                let gamePageHtml: string;
                try {
                    gamePageHtml = await fetchWithRetry(gamePageUrl);
                } catch (_error) {
                    continue;
                }

                const gamePageData = scrapGamePage(gamePageHtml);
                if (!gamePageData) continue;

                const region = getRegion(game.name);

                const regionKey = findRegionKey(gamePageData.regions, region);
                if (!regionKey) {
                    console.log(`⚠️ [INFO] Region not found.`);
                    continue;
                }

                const gamivoMerchantKey = findGamivoMerchantKey(gamePageData.merchants);
                const offers = toOfferPrices(gamePageData.prices, regionKey, gamivoMerchantKey);

                const price = bestOfferPrice(offers, checkGamivoOffer);
                if (!price) continue;

                let gamivo_id: string | undefined;

                const gamivoOffer = findGamivoOffer(offers);
                if (gamivoOffer) {
                    const gamivo_slug = await fetchGamivoSlug(gamivoOffer.id);
                    if (gamivo_slug) {
                        gamivo_id = await fetchGamivoIdBySlug(gamivo_slug) ?? undefined;
                    }
                }

                const displayRegion = region === "global" ? "" : region.toUpperCase();
                game.name = removeRegion(game.name);

                foundGames.push({
                    id: game.id,
                    name: game.name,
                    foundName: match.name,
                    popularity: game.popularity,
                    region: displayRegion,
                    id_steam: game.id_steam,
                    gamivo_id,
                    GamivoPrice: price,
                });

                console.log(`🔍 [INFO] Price found: ${price}`);
            }

            console.log(
                `✅ [INFO] Completed AllKeyShop search - found prices for ${foundGames.length}/${gamesToSearch.length} games`,
            );
            return foundGames;
        } catch (error) {
            invalidateSharedSession();
            throw error;
        }
    });
};

export class AllKeyShopPriceFetcher implements PriceFetcher {
    async fetch(games: FoundGames[], checkGamivoOffer: boolean): Promise<FoundGames[]> {
        return searchAllKeyShop(games, checkGamivoOffer);
    }
}
