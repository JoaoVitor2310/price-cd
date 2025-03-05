
import puppeteer from 'puppeteer-extra';
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from 'puppeteer';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config(); // Carregar variáveis de ambiente

// Capturar variáveis de ambiente após o dotenv.config
const apiG2aUrl = process.env.apiG2aUrl;
const timeOut = process.env.timeOut;

// Converter importações locais para require
import { clearString } from '../helpers/clearString.js';
import clearDLC from '../helpers/clearDLC.js';
import { worthyByPopularity } from '../helpers/worthyByPopularity.js';
import { clearEdition } from '../helpers/clearEdition.js';

puppeteer.use(
    StealthPlugin()
);


export const searchG2A = async (minPopularity, popularity, gamesToSearch: string[], gameType = "Steam Key", region = "GLOBAL") => {
    let precoG2A, lineToWrite, browser, gameString: string = '';

    try {

        browser = await puppeteer.launch({
            // userDataDir: null, // Define o diretório de dados do usuário como null para abrir uma janela anônima
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.setViewport({
            width: 1920,
            height: 1080
        });


        let gameUrl: string = '';

        for (const [index, game] of gamesToSearch.entries()) {
            console.log(`Índice: ${index}, Jogo:`, game);

            gameString = clearEdition(game);

            let searchString = gameString.replace(/ /g, "%20").replace(/\//g, "%2F").replace(/\?/g, "%3F").replace(/™/g, '').replace(/'/g, "%27"); // Substitui: " " -> "%20", "/" -> "%2F" e "?" -> "%3F" e "™" -> ""

            // console.log("searchString: " + searchString);
            await page.goto(`https://www.g2a.com/pt/search?query=${searchString}`);
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        // Obtém todos os resultados da pesquisa do nome do jogo
        const resultados = await page.$$('a');

        gameString = clearString(gameString);

        // console.log(gameString); //

        for (const link of resultados) {
            let gameName = await page.evaluate(element => element.textContent, link);

            gameName = clearString(gameName);
            // console.log(gameName); // 

            // const gameStringPattern = new RegExp(`^${gameString} \\(PC\\)`, 'i');
            const gameStringPattern = new RegExp(`^${gameString}( \\(PC\\)| Steam Key)`, 'i');

            // if (gameName.includes(gameString) && gameName.includes(gameType.toLowerCase()) && gameName.includes(region.toLowerCase())) {
            if (gameStringPattern.test(gameName) && gameName.includes(gameType.toLowerCase()) && gameName.includes(region.toLowerCase())) {
                gameUrl += await page.evaluate(element => element.getAttribute('href'), link);
                break;
            }
        }


        const regex = /i(\d+)/;

        // Extrai o número do produto do URL usando a expressão regular
        const match = gameUrl.match(regex);

        // Verifica se houve correspondência e extrai o número do produto
        const productId = match ? match[1] : null;


        try {
            const response = await axios.get(`${apiG2aUrl}/g2a/api/products/priceResearcher/${productId}`);

            precoG2A = response.data.menorPreco;

            // lineToWrite = worthyByPopularity(precoG2A, minPopularity, popularity);
            return lineToWrite.replace('.', ',');
        } catch (error) {
            // console.log(error);
            console.log("jogo não encontrado ou arquivo env faltando.");
            return "F";
        }
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

export default searchG2A;