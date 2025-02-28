import puppeteer from 'puppeteer-extra';
import { DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from 'puppeteer';
import AdblockerPlugin from 'puppeteer-extra-plugin-adblocker';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

import dotenv from 'dotenv';
import qs from 'qs';

dotenv.config(); // Carregar variáveis de ambiente

const timeOut = process.env.timeOut; // Obter tempo limite das variáveis de ambiente

// Importações locais usando import
import clearString from './helpers/clearString.js';
import clearDLC from './helpers/clearDLC.js';
import worthyByPopularity from './helpers/worthyByPopularity.js';
import axios from 'axios';

puppeteer.use(
    StealthPlugin()
);

const searchKinguin = async (gameString, minPopularity, popularity) => {
    let browser;

    try {
        browser = await puppeteer.launch({
            userDataDir: null, // Define o diretório de dados do usuário como null para abrir uma janela anônima
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();

        await page.setViewport({
            width: 426,
            height: 240
        });

        let searchString = clearDLC(gameString), gameHref;

        searchString = searchString.replace(/ /g, "%20").replace(/\//g, "%2F").replace(/\?/g, "%3F").replace(/™/g, '').replace(/'/g, "%27"); // Substitui: " " -> "%20", "/" -> "%2F" e "?" -> "%3F", "™" -> "" e "'" -> "%27"

        let elementoClicado = false, gameName, externalId;

        await page.goto(`https://www.kinguin.net/listing?active=1&hideUnavailable=0&phrase=${searchString}&size=50&sort=bestseller.total,DESC`);

        // const games = await page.$$eval('h3[title]', h3s => h3s.map(h3 => h3.textContent)); // Separa o nome dos jogos
        const games = await page.$$eval('h3[title]', h3s => h3s.map(h3 => ({ title: h3.textContent, href: h3.querySelector('a').href })));

        gameString = clearDLC(gameString);
        gameString = clearString(gameString);
        // console.log("gameString: " + gameString);

        for (const game of games) { // For para entrar na página do jogo
            if (game.title.includes('Steam CD Key')) {

                // gameName = game.substring(0, game.indexOf('Steam CD Key')).trim(); // Extrai a parte da string até "Steam CD Key"
                gameName = game.title.substring(0, game.title.indexOf('Steam CD Key')).trim(); // Extrai a parte da string até "Steam CD Key"

                gameName = clearString(gameName);
                gameName = clearDLC(gameName);

                // console.log("gameName: " + gameName);

                if (gameName == gameString) {
                    // await page.waitForSelector(`h3[title="${game}"]`, { timeout: timeOut });
                    // await page.click(`h3[title="${game}"]`); // As vezes aqui é o suficiente

                    // const selector = `h3[title="${game}"]`; // As vezes precisa clicar por aqui
                    // await page.evaluate((selector) => {
                    //     const element = document.querySelector(selector);
                    //     if (element) {
                    //         element.click();
                    //     } else {
                    //         console.log('Não encontrado');
                    //     }
                    // }, selector);

                    gameHref = game.href; // Armazena o href do jogo

                    const regex = /\/(\d+)\//;
                    const match = gameHref.match(regex);

                    // Armazena o ID da categoria diretamente, sem usar if
                    externalId = match ? match[1] : null;

                    // console.log('external_id: ' + externalId);
                    elementoClicado = true;
                    break;

                }
            }
        }

        let token, productId, menorPreco = Number.MAX_SAFE_INTEGER;

        let data1 = qs.stringify({
            'grant_type': 'client_credentials',
            'client_id': process.env.kinguinClient_id,
            'client_secret': process.env.kinguinClient_secret
        });

        const response = await axios.post(
            'https://id.kinguin.net/auth/token',
            data1,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                }
            }
        );
        token = response.data.access_token;



        const response1 = await axios.get(`https://gateway.kinguin.net/kpc/api/v1/products/search/findByTypeAndExternalId?type=kinguin&externalId=${externalId}`);
        productId = response1.data._embedded.products[0].id;
        // console.log(productId);



        const response2 = await axios.get(`https://gateway.kinguin.net/sales-manager-api/api/v1/wholesale/product/${productId}/offers`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const products = response2.data;
        for (let product of products) {

            const precoAtual = product.price.amount;

            if (precoAtual < menorPreco) menorPreco = precoAtual;

        }

        if (menorPreco == Number.MAX_SAFE_INTEGER) return 'F';

        menorPreco = (menorPreco / 100);
        menorPreco = menorPreco - 0.01;

        const lineToWrite = worthyByPopularity(menorPreco, minPopularity, popularity);
        return lineToWrite.replace('.', ',');;


        // A PARTIR DAQUI É O CÓDIGO DE COMO ERA FEITO FAZENDO 100% PELO SCRAPPING NO SITE DA KINGUIN

        // if (!elementoClicado) {
        //     return "F";
        //     // throw new Error('Jogo não encontrado.');
        // }

        // await rejectCookies(page); // Rejeita os cookies

        // await page.waitForSelector('div.sc-h0oox2-4', { timeout: timeOut }); // Aguarda o seletor da div do menu de moedas
        // await page.waitForSelector('button.sc-o4ugwn-5', { timeout: timeOut }); // Aguarda o seletor da div do menu de moedas

        // await page.evaluate(() => { // Função para abrir o menu de seleção de moeda
        //     const div = document.querySelector('div.sc-h0oox2-4');
        //     if (div) {
        //         div.click();

        //         // Adicionando ação para clicar no primeiro botão
        //         const button = document.querySelector('button.sc-o4ugwn-5');
        //         if (button) {
        //             button.click();
        //         } else {
        //             console.log('Botão não encontrado.');
        //         }
        //     } else {
        //         console.log('Elemento div não encontrado.');
        //     }
        // });

        // await page.waitForSelector('em.sc-o4ugwn-12', { timeout: timeOut });
        // await page.$eval('em.sc-o4ugwn-12', emElement => emElement.click()); // Clica em EUR

        // await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeOut });

        // let values;

        // await page.waitForSelector('div.offer-item-wrapper span[content]', { timeout: timeOut }).catch(() => { });
        // const elementoPresente = await page.$('div.offer-item-wrapper span[content]');
        // if (elementoPresente) {
        //     // Se o elemento estiver presente, espera até que o seletor esteja presente com o timeout especificado
        //     await page.waitForSelector('div.offer-item-wrapper span[content]', { timeout: timeOut });
        //     values = await page.$$eval('div.offer-item-wrapper span[content]', spans => spans.map(span => span.getAttribute('content')));
        //     console.log('ia fazer o splice: ' + values);
        //     values = values.replace('€', '');
        //     // values.splice(0, 2);
        // } else { // Só tem um vendedor, o preço vai aparecer só lá em cima na página
        //     console.log('Só tem um vendedor na kinguin');
        //     console.log('NÃO ia fazer o splice')
        //     await page.waitForSelector('span.sc-1kj1cv9-5.iDdryn.main-offer__price', { timeout: timeOut });

        //     const textoSegundoSpan = await page.evaluate(() => {
        //         const secondSpan = document.querySelector('span.sc-1kj1cv9-5.iDdryn.main-offer__price > span:nth-child(2)');
        //         if (secondSpan) {
        //             return secondSpan.textContent.trim();
        //         } else {
        //             return null;
        //         }
        //     });

        // const textoSegundoSpan = await Promise.race([
        //     page.evaluate(() => {
        //         const secondSpan = document.querySelector('span.sc-1kj1cv9-5.iDdryn.main-offer__price > span:nth-child(2)');
        //         if (secondSpan) {
        //             return secondSpan.textContent.trim();
        //         } else {
        //             return null;
        //         }
        //     }),
        //     new Promise((resolve) => setTimeout(resolve, 3000))
        // ]);




        //     values = textoSegundoSpan.replace('€', ''); // Remove o símbolo de euro
        //     values = values - 0.01;
        //     console.log('values: ' + values)
        // }

        // return 'A'; // Debug


        // let prices, lineToWrite;
        // if (Array.isArray(values)) { // Mais de um vendedor
        //     prices = values.filter(value => value !== "EUR");
        //     const menorPreco = prices[0];
        //     const segundoMenorPreco = prices[1];
        //     let finalPrice = 0;

        //     if (segundoMenorPreco > 1.0) { // Lógica para os samfiteiros
        //         const diferenca = segundoMenorPreco - menorPreco;
        //         const dezPorCentoSegundoMenorPreco = 0.1 * segundoMenorPreco;

        //         if (diferenca >= dezPorCentoSegundoMenorPreco) {
        //             console.log('SAMFITEIRO!');
        //             console.log('1');
        //             finalPrice = segundoMenorPreco - 0.01;
        //         } else {
        //             console.log('2');
        //             console.log(menorPreco);
        //             finalPrice = menorPreco - 0.01;
        //         }

        //         lineToWrite = worthyByPopularity(finalPrice, minPopularity, popularity);

        //         return lineToWrite.replace('.', ',');
        //     } else {
        //         console.log('3');
        //         finalPrice = menorPreco - 0.01;
        //         lineToWrite = worthyByPopularity(finalPrice, minPopularity, popularity);
        //         return lineToWrite.replace('.', ',');
        //     }
        // } else { // Um vendedor
        //     lineToWrite = worthyByPopularity(values, minPopularity, popularity);
        //     return lineToWrite.replace('.', ',');
        // }

    } catch (error) {
        // Jogo não encontrado ou o timeout tá mt rápido e não dá tempo de carregar a página;
        // console.log(error);
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

}


const rejectCookies = async (page) => {
    // Aguarda até que o seletor esteja presente, mas não gera erro se não estiver
    await page.waitForSelector('#onetrust-reject-all-handler', { timeout: 0 }).catch(() => { });

    // Verifica se o botão de aceitar cookies está presente
    const rejectButton = await page.$('#onetrust-reject-all-handler');

    // Se o botão de aceitar cookies estiver presente, clique nele
    if (rejectButton) {
        await rejectButton.click();
        // console.log('Cookies negados.');
    }
}


export default searchKinguin;