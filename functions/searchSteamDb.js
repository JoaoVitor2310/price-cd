import puppeteer from 'puppeteer-extra'; // Importar puppeteer-extra
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from 'puppeteer'; // Importar DEFAULT_INTERCEPT_RESOLUTION_PRIORITY
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker'; // Plugin de bloqueio de anúncios

import dotenv from 'dotenv'; // Usar require para dotenv
dotenv.config(); // Carregar variáveis de ambiente

const timeOut = process.env.timeOut; // Variável de ambiente para tempo limite

// Importações locais usando import
import clearString from './helpers/clearString.js'; // Assumindo que estes são módulos JS no mesmo diretório
import clearRomamNumber from './helpers/clearRomamNumber.js';
import clearDLC from './helpers/clearDLC.js';
import clearEdition from './helpers/clearEdition.js';

puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);


const searchSteamDb = async (gameString) => {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();

        // const context = await browser.createBrowserContext();

        // const page = await context.newPage();

        await page.setViewport({
            width: 426,
            height: 240
        });

        await page.goto(`https://steamcharts.com/`);

        await page.waitForSelector('input[placeholder="search games"]');

        // Seletor do elemento de entrada
        const inputElement = await page.waitForSelector('input[placeholder="search games"]', { visible: true });


        let gameStringClean = clearRomamNumber(gameString);
        gameStringClean = clearDLC(gameStringClean);
        gameStringClean = clearEdition(gameStringClean);
        // gameStringClean = gameStringClean.trim();

        // console.log("gameStringClean: " + gameStringClean);


        // Digita o nome do jogo no elemento de entrada
        await inputElement.type(gameStringClean);
        await inputElement.press('Enter');

        await page.waitForNavigation();

        const links = await page.$$('a');

        gameString = clearDLC(gameString);
        gameString = clearEdition(gameString);
        gameString = clearString(gameString);
        gameString = gameString.toLowerCase();
        gameString = gameString.trim();

        // console.log("gameString: " + gameString)
        
        for (const link of links) {
            let gameName = await page.evaluate(el => el.textContent, link);
            
            gameName = clearString(gameName);
            gameName = clearDLC(gameName);
            gameName = clearEdition(gameName);
            gameName = gameName.trim();
            // console.log("gameName: " + gameName);

            // assassin's creed chronicles russia
            // assassin’s creed chronicles russia
            // console.log("gameName: " + gameName); // Debug
            // console.log("gameString: " + gameString);

            if (gameName == gameString) {
                await link.click();
                break; // Finaliza o loop pois encontrou o elemento
            }
        }

        await page.waitForSelector('span.num', { timeout: timeOut });
        const spans = await page.$$('span.num');

        const popularity = await page.evaluate(span => span.textContent.trim(), spans[1]);
        // console.log('Pico em 24h:', popularity);

        // await new Promise(resolve => setTimeout(resolve,  10000)); // Debug, espera 300 segundos para depois fechar o navegador

        return popularity;
    } catch (error) {
        // console.log(error);
        return "F";
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

export default searchSteamDb;