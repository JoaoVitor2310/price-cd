import puppeteer from 'puppeteer-extra';
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from 'puppeteer';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config(); // Carregar variáveis de ambiente

// Capturar variáveis de ambiente após o dotenv.config
const apiGamivoUrl = process.env.apiGamivoUrl;
const timeOut = process.env.timeOut;

// Importações locais usando import
import clearString from './helpers/clearString.js';
import clearDLC from './helpers/clearDLC.js';
import worthyByPopularity from './helpers/worthyByPopularity.js';
import clearEdition from './helpers/clearEdition.js';

puppeteer.use(
    StealthPlugin()
);

const searchGamivo = async (gameString, minPopularity, popularity) => {
    let precoGamivo, lineToWrite, productString, browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        await page.setViewport({
            width: 426,
            height: 240
        });

        gameString = clearEdition(gameString);

        let searchString = gameString.replace(/ /g, "%20").replace(/\//g, "%2F").replace(/\?/g, "%3F").replace(/™/g, '').replace(/'/g, "%27"); // Substitui: " " -> "%20", "/" -> "%2F" e "?" -> "%3F" e "™" -> ""

        // console.log("searchString: " + searchString);
        await page.goto(`https://www.gamivo.com/pt/search/${searchString}`);

        // await new Promise(resolve => setTimeout(resolve, 60000000)); 

        await page.waitForSelector('.search-results__tiles', { timeout: timeOut });

        // Obtém todos os resultados da pesquisa do nome do jogo
        const resultados = await page.$$('.product-tile__name');

        gameString = clearString(gameString);
        gameString = clearDLC(gameString);
        // console.log(gameString);

        // Itera sobre cada resultado
        for (const resultado of resultados) {
            // Obtém o texto do elemento "span" com a classe "ng-star-inserted" dentro do resultado
            let gameName = await resultado.$eval('span.ng-star-inserted', element => element.textContent);

            gameName = clearString(gameName);
            gameName = clearDLC(gameName);
            // console.log(gameName);
            
            // Verifica se o texto do jogo contém a palavra "Steam"
            if (gameName.includes(gameString)) {
                // const regex = new RegExp(`${gameString}\\s*[a-zA-Z0-9/.]+\\sGlobal`, 'i'); // Padrão: nome do jogo - região - "Global"
                const regex = new RegExp(`${gameString}\\s*(?!2\\s)[a-zA-Z0-9/.]+\\sGlobal(?:\\s(steam)|$)`, 'i');

                // const regex2 = new RegExp(`${gameString}\\sGlobal Steam$`, 'i');
                const regex2 = new RegExp(`${gameString}\\s*Global Steam$`, 'i');
                
                const regex3 = new RegExp(`${gameString}\\sROW\\sSteam$`, 'i');            

                if (regex.test(gameName) || regex2.test(gameName) || regex3.test(gameName)) {
                // if (regex.test(gameName)) {
                    // Clica no resultado
                    // console.log("gameName: " + gameName);

                    const elementoLink = await resultado.$('a');
                    const href = await (await elementoLink.getProperty('href')).jsonValue();
                    
                    const startIndex = href.indexOf('/product/') + '/product/'.length;
                    productString = href.substring(startIndex);
                    // console.log(productString);

                    break; // Encerra o loop depois de clicar em um resultado
                }
            }
        }

        if (productString) {
            try {
                const response = await axios.get(`${apiGamivoUrl}/api/products/priceResearcher/${productString}`);

                const precoGamivo = response.data.menorPreco ;

                lineToWrite = worthyByPopularity(precoGamivo, minPopularity, popularity);

            } catch (error) {
                console.log(error);
                console.log('API Gamivo desligada ou arquivo env faltando');
                return "F";
            }
        } else {
            return "F";
        }


        return lineToWrite.replace('.', ',');

    } catch (error) {
        // console.log(error);
        // console.log('Ou o timeout tá mt rápido e não dá tempo de carregar a página');
        return 'F';
    } finally {
        const pages = await browser.pages();
        if (pages) await Promise.all(pages.map((page) => page.close()));
        const childProcess = browser.process()
        if (childProcess) {
            childProcess.kill()
        }
        await browser.close();
        if (browser && browser.process() != null) browser.process().kill('SIGINT');
    }
};

export default searchGamivo;