import { Response } from "express";
import { MulterRequest } from "../interfaces/MulterRequest";
import fs from 'fs';
import searchGamivo from "../service/searchGamivo";
import searchG2A from "../service/searchG2A";
import { searchSteamDb } from "../service/searchSteamDb";
import { worthyByPopularity } from "../helpers/worthyByPopularity";

export const uploadFile = async (req: MulterRequest, res: Response) => {
    if (!req.file) {
        return res.status(400).send('Nenhum arquivo enviado.');
    }

    // return res.status(400).json(req.file);

    const horaAtual = new Date();
    const options = { timeZone: 'America/Sao_Paulo', hour12: false };
    const hora1 = horaAtual.toLocaleTimeString('pt-BR', options);

    // const hora1 = new Date().toLocaleTimeString();

    let gamesToSearch = [], responseFile = '', priceGamivo, priceG2A, priceKinguin;
    const filePath = req.file.path;
    const fileContent = fs.readFileSync(filePath, 'utf8');

    const lines = fileContent.split('\n');

    const minPopularity = Number(lines[0]); // Primeira posição será a popularidade mínima
    lines.shift(); // Retira a popularidade do array

    // Iterar sobre as linhas e armazenar o conteúdo no array gamesToSearch
    for (const line of lines) {
        // Remover espaços em branco no início e no final de cada linha
        const trimmedLine: string = line.trim();

        // Verificar se a linha não está vazia
        if (trimmedLine !== '') {
            // @ts-ignore
            gamesToSearch.push(trimmedLine);
        }
    }

    // let foundGames = await searchSteamDb(gamesToSearch);
    let foundGames = [
        {
            "id": 0,
            "name": "Terraformers",
            "popularity": 141
        },
        {
            "id": 2,
            "name": "The Elder Scrolls V: Skyrim Special Edition",
            "popularity": 29965
        },
        {
            "id": 3,
            "name": "patrician iii",
            "popularity": 66
        },
        {
            "id": 4,
            "name": "Sid Meier's Civilization IV: Beyond the Sword",
            "popularity": 2000
        },
        {
            "id": 5,
            "name": "the walking dead",
            "popularity": 219
        },
        {
            "id": 6,
            "name": "nuclear throne",
            "popularity": 137
        },
        {
            "id": 7,
            "name": "the long dark",
            "popularity": 3146
        },
        {
            "id": 8,
            "name": "Symphony of War: The Nephilim Saga",
            "popularity": 701
        },
        {
            "id": 9,
            "name": "Coromon",
            "popularity": 322
        },
        {
            "id": 10,
            "name": "The Excavation of Hob's Barrow",
            "popularity": 18
        }
    ];

    foundGames = worthyByPopularity(foundGames, minPopularity);
    const gamivo = await searchGamivo(foundGames);
    return res.status(200).json(foundGames);


    // O for vai passar em todos os gamesToSearch
    for (let game of gamesToSearch) {
        let search = true, fullLine, popularity;
        console.log("Game: " + game);
        const G2A = await searchG2A(minPopularity, 100, gamesToSearch);
        // return res.status(200).json(G2A);


        console.log(gamivo);
        // return res.status(200).json(popularity);

        minPopularity !== 0 ? popularity = await searchSteamDb(game) : popularity = 999;
        // let popularity = 2442; // Debug

        if (popularity == 'F') continue;

        if (popularity < minPopularity) search = false;

        //Converte para o formato brasileiro com .
        // CHECAR SE É Number
        if (!isNumber(popularity)) {
            if (popularity.includes(',')) { popularity = popularity.replace(',', '.'); }
            let popularityNumber = parseFloat(popularity);
            let decimalPlaces = (popularity.split('.')[1] || '').length;
            popularity = popularityNumber.toFixed(decimalPlaces);
        }

        if (popularity <= 0 || !search) continue;

        priceGamivo = await searchGamivo(game, minPopularity, popularity);
        if (priceGamivo !== 'F' && priceGamivo !== 'N') {
            fullLine = `G2A\t${priceGamivo}\tKinguin\t\t\t\t${popularity}\t${game}\n`;
            responseFile += fullLine;
        }

        console.log(fullLine);
    }

    console.log("responseFile:\n" + responseFile);

    // res.json('A'); // DEBUG
    // return;


    fs.writeFileSync(filePath, responseFile);

    res.download(filePath, 'resultado-price-researcher.txt', (err) => {
        // Verifica se houve algum erro durante o download

        const newHoraAtual = new Date();
        const options = { timeZone: 'America/Sao_Paulo', hour12: false };
        const hora2 = newHoraAtual.toLocaleTimeString('pt-BR', options);

        console.log(`Horário de início: ${hora1}, horário de término: ${hora2}`);
        if (err) {
            console.error('Erro ao fazer o download do arquivo:', err);
            fs.unlinkSync(filePath);
        } else {
            // Se o download for bem-sucedido, exclui o arquivo
            fs.unlinkSync(filePath);
        }
    });
}