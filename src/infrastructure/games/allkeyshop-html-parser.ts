import * as cheerio from "cheerio";
import type { GameData } from "@/infrastructure/games/allkeyshop.types.js";

export type SearchResult = { link: string; name: string; price: string };

export const scrapSearchResults = (html: string): SearchResult[] => {
    const $ = cheerio.load(html);

    const links = $('a.absolute').map((_, el) => $(el).attr('href') || '').get();
    const names = $('p.text-md.text-white').map((_, el) => $(el).text().trim()).get();
    const prices = $('a.price-skew span').map((_, el) => $(el).text().trim()).get();

    const length = Math.min(links.length, names.length, prices.length);

    const searchResults: SearchResult[] = [];
    for (let i = 0; i < length; i++) {
        searchResults.push({
            link: links[i],
            name: names[i],
            price: prices[i].toString().replace("€", "").replace(".", ","),
        });
    }

    return searchResults;
};

export const scrapGamePage = (html: string): GameData | null => {
    const $ = cheerio.load(html);

    const scriptContent = $('script#aks-offers-js-extra').html();

    if (!scriptContent) return null;

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
};

export const extractGamivoSlug = (html: string): string | null => {
    const match = html.match(/gamivo\.com\/product\/([^/?]+)/);
    return match?.[1] ?? null;
};
