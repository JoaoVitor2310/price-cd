import dotenv from 'dotenv'; // Usar require para dotenv
dotenv.config(); // Carregar variáveis de ambiente

// Importações locais usando import
import clearDLC from '../helpers/clearDLC.js';
import { clearEdition } from '../helpers/clearEdition.js';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { foundGames } from '../interfaces/foundGames.js';
import { clearString } from '../helpers/clearString.js';

export const searchSteamDb = async (gamesToSearch: string[]): Promise<foundGames[]> => {
    const foundGames: foundGames[] = [];
    for (const [index, gameString] of gamesToSearch.entries()) {


        let response: AxiosResponse | undefined;
        console.log('gameString: ' + gameString);

        let gameStringClean: string = gameString;
        gameStringClean = clearEdition(gameStringClean);
        const params = new URLSearchParams({ q: gameStringClean });
        // console.log(`https://steamcharts.com/search/?${params.toString()}`);

        try {
            response = await axios.get(`https://steamcharts.com/search?${params.toString()}`);
        } catch (error) {
            // console.error('Erro ao buscar no SteamDb:', error);
            continue;
        }

        if (!response || !response.data) continue;

        // let gameStringClean: string = clearRomamNumber(gameString);
        gameStringClean = clearDLC(gameStringClean);
        gameStringClean = clearString(gameStringClean);
        gameStringClean = gameStringClean.toLowerCase().trim();
        // console.log('gameStringClean: ' + gameStringClean);

        const $search = cheerio.load(response.data);
        const links: { href: string; text: string }[] = [];

        $search('a').each((_, element) => {
            const href = $search(element).attr('href'); // Obtém o atributo href de cada <a>
            const text = $search(element).text().trim(); // Obtém o texto dentro da tag <a> e remove espaços em branco
            if (href && text) {
                links.push({ href, text });
            }
        });

        let id: string = '';

        for (const link of links) {
            let gameName = clearString(link.text);
            gameName = clearDLC(gameName);
            gameName = clearEdition(gameName).trim().toLowerCase();
            gameName = gameName.trim().toLowerCase();

            // console.log('gameName: ' + gameName);
            if (gameName === gameStringClean) {
                id = link.href;
                break; // Finaliza o loop pois encontrou o elemento
            }
        }

        if (id == '') continue;


        try {
            response = await axios.get(`https://steamcharts.com${id}`);
        } catch (error) {
            // console.error('Erro ao buscar no SteamDb (segunda requisição):', error);
            continue;
        }

        if (!response || !response.data) continue;


        const $details = cheerio.load(response.data);
        const spans: string[] = [];

        $details('span.num').each((_, element) => {
            const numText = $details(element).text().trim(); // Pega o texto do span e remove espaços extras
            if (numText) {
                spans.push(numText); // Adiciona o texto ao array
            }
        });

        if (spans.length < 1) continue;
        console.log('popularity: ' + Number.parseInt(spans[1]));
        foundGames.push({ id: index, name: gameString, popularity: Number.parseInt(spans[1]) });
    }

    return foundGames;
};