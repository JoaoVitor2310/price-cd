import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import axios, { AxiosResponse } from 'axios';
import dotenv from 'dotenv';
import { connect } from "puppeteer-real-browser";

dotenv.config(); // Carregar variáveis de ambiente

// Capturar variáveis de ambiente após o dotenv.config
const apiGamivoUrl = process.env.apiGamivoUrl;
const timeOut = Number(process.env.timeOut) || 3000;

// Importações locais
import { clearString } from '../helpers/clearString.js';
import { clearDLC } from '../helpers/clearDLC.js';
import { clearEdition } from '../helpers/clearEdition.js';
import { foundGames } from '../types/foundGames.js';
import { hasEdition } from '../helpers/hasEdition.js';

puppeteer.use(
    StealthPlugin()
);

export const searchGamivo = async (gamesToSearch: foundGames[]): Promise<foundGames[]> => {
    let productSlug: string = '';
    // let browser: any;
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

    for (const [index, game] of gamesToSearch.entries()) {
        console.log(`Índice: ${index}, Jogo:`, game.name);
        let searchString = encodeURIComponent(game.name).replace(/%E2%84%A2/g, ''); // Remove "™"

        // browser = await puppeteer.launch({
        //     headless: false,
        //     args: [
        //         '--no-sandbox',
        //         '--disable-setuid-sandbox',
        //         '--disable-client-side-phishing-detection',
        //         '--disable-blink-features=AutomationControlled',
        //         '--disable-features=IsolateOrigins,site-per-process',
        //         '--disable-cache',
        //         '--user-data-dir=/path/to/user/data',
        //         '--use-fake-ui-for-media-stream',
        //         '--use-fake-device-for-media-stream',
        //         '--ignore-certificate-errors',
        //         '--allow-running-insecure-content',
        //     ]
        // });

        // const { browser, page } = await connect({
        //     headless: false,

        //     args: [],

        //     customConfig: {},

        //     turnstile: true,

        //     connectOption: {},

        //     disableXvfb: false,
        //     ignoreAllFlags: false,
        //   });


        // const page = await browser.newPage();
        try {
            await page.setViewport({
                width: 426,
                height: 240
            });

            await page.goto(`https://www.gamivo.com/pt/search/${searchString}`);

            // @ts-ignore
            await page.waitForSelector('.search-results__tiles', { timeout: timeOut }).catch(async (error) => {
                console.log('A página foi redirecionada após o CAPTCHA. Tentando navegar novamente.');

                // Verifique a URL após o erro de seletor
                const currentUrl = page.url();

                // await new Promise(resolve => setTimeout(resolve, 20000));

                // const newPage = await context.newPage();
                await page.goto(`https://www.gamivo.com/pt/search/${searchString}`);
                await page.waitForSelector('.search-results__tiles', { timeout: timeOut });
            });

            const resultados = await page.$$('.product-tile__name');

            let gameString = game.name;
            let gameStringClean: string = clearEdition(gameString);
            gameStringClean = clearString(gameStringClean);
            gameStringClean = clearDLC(gameStringClean);
            gameStringClean = gameStringClean.toLowerCase().trim();
            // console.log('gameStringClean: ' + gameStringClean);

            // Itera sobre cada resultado
            for (const resultado of resultados) {
                // Obtém o texto do elemento "span" com a classe "ng-star-inserted" dentro do resultado
                // @ts-ignore
                let gameName = await resultado.$eval('span.ng-star-inserted', element => element.textContent || '');

                let gameNameClean = clearEdition(gameName);
                gameNameClean = clearString(gameNameClean);
                gameNameClean = clearDLC(gameNameClean);
                gameNameClean = gameNameClean.toLowerCase().trim();
                // console.log(gameNameClean);

                // Verifica se o texto do jogo contém a palavra "Steam"
                if (gameNameClean.includes(gameStringClean)) {
                    const regex = new RegExp(`^${gameStringClean}\\s*(?!2\\s)([a-z]{2}(?:/[a-z]{2})*)?\\sGlobal(?:\\ssteam)?$`, 'i');

                    // const regex2 = new RegExp(`${gameStringClean}\\sGlobal Steam$`, 'i');
                    const regex2 = new RegExp(`^${gameStringClean}\\s*Global Steam$`, 'i');

                    const regex3 = new RegExp(`^${gameStringClean}\\sROW\\sSteam$`, 'i');

                    if (regex.test(gameNameClean) || regex2.test(gameNameClean) || regex3.test(gameNameClean)) {
                        // Clica no resultado

                        // if (regex.test(gameNameClean)) {
                        // console.log("gameNameClean certo: " + gameNameClean);


                        const gameStringKeywords = hasEdition(gameString);
                        const gameNameKeywords = hasEdition(gameName);

                        // Se um dos conjuntos tiver palavras-'edition' que o outro não tem, faz "continue"
                        if (![...gameStringKeywords].every(keyword => gameNameKeywords.has(keyword)) ||
                            ![...gameNameKeywords].every(keyword => gameStringKeywords.has(keyword))) {
                            continue;
                        }


                        const elementoLink = await resultado.$('a');
                        if (!elementoLink) continue;

                        const href = await (await elementoLink.getProperty('href')).jsonValue();

                        const startIndex = href.indexOf('/product/') + '/product/'.length;
                        productSlug = href.substring(startIndex);
                        console.log(productSlug);

                        // break; // Encerra o loop depois de clicar em um resultado
                    }
                }
            }

            if (productSlug == '') continue;

            try {
                response = await axios.get(`${apiGamivoUrl}/api/products/priceResearcher/${productSlug}`);
                const precoGamivo: number = response.data.menorPreco;
                const precoFormatado: string = precoGamivo.toString().replace('.', ',');
                console.log('precoGamivo: ' + precoFormatado);


                foundGames.push({ id: index, name: game.name, popularity: game.popularity, GamivoPrice: precoFormatado });
            } catch (error) {
                console.log(error);
                console.log('API Gamivo desligada ou arquivo env faltando');
                continue;
            }
        } catch (error) {
            console.log('não achou');
            // console.log(error)
        } finally {
            // if (browser) {
            //     const pages = await browser.pages();
            //     // @ts-ignore
            //     if (pages) await Promise.all(pages.map((page) => page.close()));

            //     const childProcess = browser.process()
            //     if (childProcess) {
            //         childProcess.kill()
            //     }

            //     await browser.close();

            //     // @ts-ignore
            //     if (browser && browser.process()) browser.process().kill('SIGINT');
            // }
        }
    }

    const pages = await browser.pages();
    // @ts-ignore
    if (pages) await Promise.all(pages.map((page) => page.close()));

    const childProcess = browser.process()
    if (childProcess) {
        childProcess.kill()
    }

    await browser.close();

    // @ts-ignore
    if (browser && browser.process()) browser.process().kill('SIGINT');

    return foundGames;
};