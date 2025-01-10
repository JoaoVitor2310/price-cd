import express from 'express'; // Converter require para import
import dotenv from 'dotenv'; // Converter require para import
dotenv.config(); // Configuração do dotenv para carregar variáveis de ambiente

import path from 'path'; // Converter require para import
import multer from 'multer'; // Converter require para import
import fs from 'fs'; // Converter require para import

// Importações locais usando import
import searchSteamDb from './functions/searchSteamDb.js';
import searchGamivo from './functions/searchGamivo.js';
import searchG2A from './functions/searchG2A.js';
import searchKinguin from './functions/searchKinguin.js';
import { isNumber } from 'puppeteer';


const app = express();

const pasta = path.join(process.cwd());
app.use(express.static(pasta));
app.use(express.json());

app.get('/', (req, res) => {
      res.send('Desenvolvido por João Vitor Gouveia. Linkedin: https://www.linkedin.com/in/jo%C3%A3o-vitor-matos-gouveia-14b71437/');
})

const upload = multer({ dest: 'uploads/' });

app.post('/upload', upload.single('fileToUpload'), async (req, res) => {
      if (!req.file) {
            return res.status(400).send('Nenhum arquivo enviado.');
      }


      const horaAtual = new Date();
      const options = { timeZone: 'America/Sao_Paulo', hour12: false };
      const hora1 = horaAtual.toLocaleTimeString('pt-BR', options);

      // const hora1 = new Date().toLocaleTimeString();

      let gamesToSearch = [], responseFile = '', priceGamivo, priceG2A, priceKinguin;
      const filePath = req.file.path;
      const fileContent = fs.readFileSync(filePath, 'utf8');

      const lines = fileContent.split('\n');

      const minPopularity = Number(lines[0]); // Primeira posição será a popularidade mínima
      lines.shift(); // Iremos retirar a popularidade do array

      // Iterar sobre as linhas e armazenar o conteúdo no array gamesToSearch
      for (const line of lines) {
            // Remover espaços em branco no início e no final de cada linha
            const trimmedLine = line.trim();

            // Verificar se a linha não está vazia
            if (trimmedLine !== '') {
                  gamesToSearch.push(trimmedLine);
            }
      }

      console.log(gamesToSearch);
      // O for vai começar aqui passando em todos os gamesToSearch
      for (let game of gamesToSearch) {
            let search = true, fullLine, popularity;
            console.log("Game: " + game);
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
})

const port = process.env.PORT || 5000;

app.listen(port, () => {
      console.log(`Price-researcher rodando em: http://localhost:${port}.`);
})