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


let isBestBuy86 = process.env.isBestBuy86;

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

      let gamesToSearch = [], lineToWrite, responseFile = '', priceGamivo, priceG2A, priceKinguin;
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


      // O for vai começar aqui passando em todos os gamesToSearch
      for (let game of gamesToSearch) {
            let search = true, fullLine, popularity;
            console.log("Game: " + game);
            minPopularity !== 0 ? popularity = await searchSteamDb(game) : popularity = 999;
            // let popularity = 2442; // Debug

            if (popularity !== 'F') { // Jogo possui mais de 0 de popularidade

                  if (isBestBuy86 == "false" && (popularity < minPopularity)) search = false;

                  //Converte para o formato brasileiro com .
                  // CHECAR SE É Number
                  if (!isNumber(popularity)) {
                        if (popularity.includes(',')) { popularity = popularity.replace(',', '.'); }
                        let popularityNumber = parseFloat(popularity);
                        let decimalPlaces = (popularity.split('.')[1] || '').length;
                        popularity = popularityNumber.toFixed(decimalPlaces);
                  }


                  if (popularity > 0 && search) {

                        if (isBestBuy86 == "false") {
                              // priceKinguin = await searcheKing(game, minPopularity, popularity);
                              // priceGamivo = await searcheGam(game, minPopularity, popularity);
                              
                              // fullLine = `G2A\t$sdasd\t\t\t\tdasdt$asd\n`; responseFile += fullLine;



                              priceGamivo = await searchGamivo(game, minPopularity, popularity);
                              if (priceGamivo !== 'F' && priceGamivo !== 'N') {
                                    fullLine = `G2A\t${priceGamivo}\tKinguin\t\t\t\t${popularity}\t${game}\n`; 
                                    responseFile += fullLine;
                              }
                        } else {
                              // priceGamivo = await searchGamivo(game, minPopularity, popularity);

                              // priceG2A = await searchG2A(game, minPopularity, popularity);

                              // priceKinguin = await searchKinguin(game, minPopularity, popularity);

                              // Executar as três funções simultaneamente
                              const promise1 = searchGamivo(game, minPopularity, popularity);
                              const promise2 = searchG2A(game, minPopularity, popularity);
                              const promise3 = searchKinguin(game, minPopularity, popularity);
                              [priceGamivo, priceG2A, priceKinguin] = await Promise.all([promise1, promise2, promise3]);
                              
                              // priceG2A = 1; // Debug
                              // priceGamivo = 1;
                              // priceKinguin = 1;

                              // [priceGamivo, priceG2A] = await Promise.all([promise1, promise2]); // Sem KINGUIN
                        }

                  } else {
                        priceGamivo = 'N';
                        priceG2A = 'N';
                        priceKinguin = 'N';
                  }
            } else { // Jogo tem 0 jogadores nas últimos 24h ou não achou os dados de popularidade
                  priceGamivo = 'N';
                  priceG2A = 'N';
                  priceKinguin = 'N';
            }
            // Escreve a linha daquele jogo(g2a gamivo kinguin 3 tabs popularidade nessa ordem)
            if (isBestBuy86 == 'true') {
                  fullLine = `${priceG2A}\t${priceGamivo}\t${priceKinguin}\t\t\t\t${popularity}\n`; // Escreve a linha para o txt
                  // fullLine = `G2A\t${priceGamivo}\tKinguin\t\t\t\t${popularity}\n`; // Debug só Gamivo
                  // fullLine = `${priceG2A}\tGamivo\tKinguin\t\t\t\t${popularity}\n`; // Debug só G2A
                  // fullLine = `G2A\tGamivo\t${priceKinguin}\t\t\t\t${popularity}\n`; // Debug só Kinguin
                  // fullLine = `${priceG2A}\t${priceGamivo}\tF\t\t\t\t${popularity}\n`; // Debug SEM Kinguin
            }

            console.log(fullLine);

            // Termina o for de cada jogo, deve finalizar de montar o arquivo txt que será enviado
            if (isBestBuy86 == 'true') responseFile += fullLine;

            // setTimeout(() => {
            //       console.log('This message is displayed after 10 seconds');
            //     }, 10000);
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