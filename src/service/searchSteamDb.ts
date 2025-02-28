import dotenv from 'dotenv'; // Usar require para dotenv
dotenv.config(); // Carregar variáveis de ambiente

// Importações locais usando import
import clearString from '../helpers/clearString.js'; // Assumindo que estes são módulos JS no mesmo diretório
import clearRomamNumber from '../helpers/clearRomamNumber.js';
import clearDLC from '../helpers/clearDLC.js';
import clearEdition from '../helpers/clearEdition.js';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';

const searchSteamDb = async (gameString: string): Promise<number> => {
    let gameStringClean: string = clearRomamNumber(gameString);
    gameStringClean = clearDLC(gameStringClean);
    gameStringClean = clearEdition(gameStringClean);

    let response: AxiosResponse | undefined;

    try {
        response = await axios.get('https://steamcharts.com/search/', {
            params: { q: gameString }
        });

    } catch (error) {
        // console.error('Erro ao buscar no SteamDb:', error);
        return 0;
    }

    if (!response || !response.data) return 0;

    gameString = clearDLC(gameString);
    gameString = clearEdition(gameString);
    gameString = clearString(gameString);
    gameString = gameString.toLowerCase();
    gameString = gameString.trim();

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
        gameName = clearEdition(gameName).trim();

        if (gameName === gameString) {
            id = link.href;
            break; // Finaliza o loop pois encontrou o elemento
        }
    }

    if (id == '') return 0;


    try {
        response = await axios.get(`https://steamcharts.com${id}`);
    } catch (error) {
        // console.error('Erro ao buscar no SteamDb (segunda requisição):', error);
        return 0;
    }

    if (!response || !response.data) return 0;


    const $details = cheerio.load(response.data);
    const spans: string[] = [];

    $details('span.num').each((_, element) => {
        const numText = $details(element).text().trim(); // Pega o texto do span e remove espaços extras
        if (numText) {
            spans.push(numText); // Adiciona o texto ao array
        }
    });

    if (spans.length < 1) return 0;

    return Number.parseInt(spans[1]); // Retorna o pico de jogadores nas últimas 24h






    // let browser;
    // try {
    //     browser = await puppeteer.launch({
    //         headless: true,
    //         args: ['--no-sandbox', '--disable-setuid-sandbox']
    //     });

    //     const page = await browser.newPage();

    //     // const context = await browser.createBrowserContext();

    //     // const page = await context.newPage();

    //     await page.setViewport({
    //         width: 426,
    //         height: 240
    //     });

    //     await page.goto(`https://steamcharts.com/`);

    //     await page.waitForSelector('input[placeholder="search games"]');

    //     // Seletor do elemento de entrada
    //     const inputElement = await page.waitForSelector('input[placeholder="search games"]', { visible: true });


    //     let gameStringClean = clearRomamNumber(gameString);
    //     gameStringClean = clearDLC(gameStringClean);
    //     gameStringClean = clearEdition(gameStringClean);
    //     // gameStringClean = gameStringClean.trim();

    //     // console.log("gameStringClean: " + gameStringClean);


    //     // Digita o nome do jogo no elemento de entrada
    //     await inputElement.type(gameStringClean);
    //     await inputElement.press('Enter');

    //     await page.waitForNavigation();

    //     const links = await page.$$('a');

    //     gameString = clearDLC(gameString);
    //     gameString = clearEdition(gameString);
    //     gameString = clearString(gameString);
    //     gameString = gameString.toLowerCase();
    //     gameString = gameString.trim();

    //     // console.log("gameString: " + gameString)

    // for (const link of links) {
    //     let gameName = await page.evaluate(el => el.textContent, link);

    //     gameName = clearString(gameName);
    //     gameName = clearDLC(gameName);
    //     gameName = clearEdition(gameName);
    //     gameName = gameName.trim();
    //     // console.log("gameName: " + gameName);

    //     // assassin's creed chronicles russia
    //     // assassin’s creed chronicles russia
    //     // console.log("gameName: " + gameName); // Debug
    //     // console.log("gameString: " + gameString);

    //     if (gameName == gameString) {
    //         await link.click();
    //         break; // Finaliza o loop pois encontrou o elemento
    //     }
    // }

    //     await page.waitForSelector('span.num', { timeout: timeOut });
    //     const spans = await page.$$('span.num');

    //     const popularity = await page.evaluate(span => span.textContent.trim(), spans[1]);
    //     // console.log('Pico em 24h:', popularity);

    //     // await new Promise(resolve => setTimeout(resolve,  10000)); // Debug, espera 300 segundos para depois fechar o navegador

    //     return popularity;
    // } catch (error) {
    //     console.log(error);
    //     return "F";
    // } finally {
    //     const pages = await browser.pages();
    //     if (pages) await Promise.all(pages.map((page) => page.close()));
    //     const childProcess = browser.process()
    //     if (childProcess) {
    //         childProcess.kill()
    //     }
    //     await browser.close();
    //     if (browser && browser.process() != null) browser.process().kill('SIGINT');

    // }
};

export default searchSteamDb;