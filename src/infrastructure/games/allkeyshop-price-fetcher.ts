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
import type { Editions, Merchants, Price, Regions } from "@/infrastructure/games/allkeyshop.types.js";
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

const editionKeywordsMatch = (a: Set<string>, b: Set<string>): boolean =>
    [...a].every((keyword) => b.has(keyword)) && [...b].every((keyword) => a.has(keyword));

/**
 * Resolve o id de edição do AllKeyShop (`editions[id].name`) que corresponde às
 * palavras de edição encontradas no nome pesquisado. Sem palavra de edição no
 * nome, procura a edição "Standard" pelo nome literal em vez de casar por Set
 * vazio — o AllKeyShop tem edições sem tier mapeado (ex.: "Bonus") que também
 * dariam Set vazio e causariam falso positivo.
 */
export const findEditionKey = (editions: Editions, gameNameKeywords: Set<string>): string | null => {
    if (gameNameKeywords.size === 0) {
        return Object.keys(editions).find(
            (key) => editions[key].name.trim().toLowerCase() === "standard"
        ) ?? null;
    }

    return Object.keys(editions).find(
        (key) => editionKeywordsMatch(hasEdition(editions[key].name), gameNameKeywords)
    ) ?? null;
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

export const toOfferPrices = (prices: Price[], regionKey: string, editionKey: string, gamivoMerchantKey: string | null): NormalizedOffer[] => {
    return prices
        .filter(p => String(p.region) === regionKey && String(p.edition) === editionKey)
        .map(p => ({
            ...p,
            merchant: gamivoMerchantKey != null && Number(p.merchant) === Number(gamivoMerchantKey)
                ? GAMIVO_MERCHANT_NAME
                : String(p.merchant),
        }));
};

/**
 * Casa o jogo pesquisado contra os resultados da busca do AllKeyShop pelo nome
 * base (edição ignorada) — a busca em si nunca leva palavra de edição na query,
 * então o título do resultado normalmente também não reflete a edição (ela mora
 * dentro da página, ver `findEditionKey`).
 *
 * A única exceção real são jogos onde a edição é um PRODUTO separado no
 * catálogo (ex.: "Skyrim" 2011 vs "Skyrim Special Edition" 2021 — remaster com
 * página própria), que aparecem como candidatos distintos com o mesmo nome
 * base. Nesse caso — e só nesse caso — a palavra de edição desempata: prefere
 * o candidato cujo título bate exatamente com a edição pedida; sem candidato
 * único e sem edição exata, cai no primeiro (ordem de relevância do próprio
 * AllKeyShop).
 */
export const matchSearchResult = (gameName: string, searchResults: SearchResult[]): { link: string; name: string } | null => {
    const gameNameClean = normalizeForMatching(gameName);
    const gameNameKeywords = hasEdition(gameName);

    const candidates = searchResults.filter(
        (searchResult) => normalizeForMatching(searchResult.name) === gameNameClean
    );

    if (candidates.length === 0) return null;

    const exactEditionMatch = candidates.find(
        (candidate) => editionKeywordsMatch(hasEdition(candidate.name), gameNameKeywords)
    );

    const match = exactEditionMatch ?? candidates[0];
    return { link: match.link, name: match.name };
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
                searchString = clearEdition(searchString);
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

                const editionKey = findEditionKey(gamePageData.editions, hasEdition(game.name));
                if (!editionKey) {
                    console.log(`⚠️ [INFO] Edition not found for "${game.name}".`);
                    continue;
                }

                const gamivoMerchantKey = findGamivoMerchantKey(gamePageData.merchants);
                const offers = toOfferPrices(gamePageData.prices, regionKey, editionKey, gamivoMerchantKey);

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
