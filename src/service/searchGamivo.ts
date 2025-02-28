import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import axios, { AxiosResponse } from 'axios';
import dotenv from 'dotenv';

dotenv.config(); // Carregar variáveis de ambiente

// Capturar variáveis de ambiente após o dotenv.config
const apiGamivoUrl = process.env.apiGamivoUrl;
const timeOut = process.env.timeOut;

// Importações locais usando import
import clearString from '../helpers/clearString.js';
import clearDLC from '../helpers/clearDLC.js';
import clearEdition from '../helpers/clearEdition.js';
import { worthyByPopularity } from '../helpers/worthyByPopularity.js';
import { foundGames } from '../interfaces/foundGames.js';

puppeteer.use(
    StealthPlugin()
);

const searchGamivo = async (minPopularity: number, popularity: number, gamesToSearch: string[]): Promise<foundGames[]> => {
    let lineToWrite: number, productSlug: string = '', browser;
    const foundGames: { id: number; lineToWrite: number }[] = [];

    let response: AxiosResponse;
    browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.setViewport({
        width: 1920,
        height: 1080
    });


    for (const [index, game] of gamesToSearch.entries()) {
        console.log(`Índice: ${index}, Jogo:`, game);

        let gameString: string = clearEdition(game);
        let searchString = game.replace(/ /g, "%20").replace(/\//g, "%2F").replace(/\?/g, "%3F").replace(/™/g, '').replace(/'/g, "%27"); // Substitui: " " -> "%20", "/" -> "%2F" e "?" -> "%3F" e "™" -> ""

        try {
            await page.goto(`https://www.gamivo.com/pt/search/${searchString}`);
            await page.waitForSelector('.search-results__tiles', { timeout: timeOut });

            const resultados = await page.$$('.product-tile__name');

            gameString = clearString(gameString);
            gameString = clearDLC(gameString);
            console.log('gameString: ' + gameString);

            // Itera sobre cada resultado
            for (const resultado of resultados) {
                // Obtém o texto do elemento "span" com a classe "ng-star-inserted" dentro do resultado
                let gameName = await resultado.$eval('span.ng-star-inserted', element => element.textContent);

                gameName = clearString(gameName);
                gameName = clearDLC(gameName);

                // Verifica se o texto do jogo contém a palavra "Steam"
                if (gameName.includes(gameString)) {
                    const regex = new RegExp(`^${gameString}\\s*(?!2\\s)([a-z]{2}(?:/[a-z]{2})*)?\\sGlobal(?:\\ssteam)?$`, 'i');

                    // const regex2 = new RegExp(`${gameString}\\sGlobal Steam$`, 'i');
                    const regex2 = new RegExp(`^${gameString}\\s*Global Steam$`, 'i');

                    const regex3 = new RegExp(`^${gameString}\\sROW\\sSteam$`, 'i');

                    if (regex.test(gameName) || regex2.test(gameName) || regex3.test(gameName)) {
                        // if (regex.test(gameName)) {
                        // Clica no resultado
                        console.log("gameName certo: " + gameName);

                        const elementoLink = await resultado.$('a');
                        const href = await (await elementoLink.getProperty('href')).jsonValue();

                        const startIndex = href.indexOf('/product/') + '/product/'.length;
                        productSlug = href.substring(startIndex);
                        // console.log(productSlug);

                        // break; // Encerra o loop depois de clicar em um resultado
                    }
                }
            }

            if (productSlug == '') continue;

            console.log('productSlug: ' + productSlug);
            try {
                response = await axios.get(`${apiGamivoUrl}/api/products/priceResearcher/${productSlug}`);
                const precoGamivo: number = response.data.menorPreco;
                console.log(precoGamivo);

                const worthy = worthyByPopularity(precoGamivo, minPopularity, popularity);
                if (worthy) {
                    lineToWrite = precoGamivo;
                    foundGames.push({ id: index, lineToWrite });
                }
            } catch (error) {
                console.log(error);
                console.log('API Gamivo desligada ou arquivo env faltando');
                continue;
            }


        } catch (error) {
            console.log('Não achou')
        }
    }
    
    const pages = await browser.pages();
    if (pages) await Promise.all(pages.map((page) => page.close()));
    const childProcess = browser.process()
    if (childProcess) {
        childProcess.kill()
    }
    await browser.close();
    if (browser && browser.process() != null) browser.process().kill('SIGINT');
    return foundGames;
    // }
};

export default searchGamivo;