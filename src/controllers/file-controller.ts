import fs from "node:fs";
import type { Response } from "express";
import type { MulterRequest } from "@/types/MulterRequest";
import { searchSteamDb } from "@/services/search-steam-db";
import { worthyByPopularity } from "@/helpers/worthy-by-popularity";
import { searchGamivo } from "@/services/search-gamivo";

// import searchG2A from "../service/searchG2A";

const timeOpts: Intl.DateTimeFormatOptions = {
	timeZone: "America/Sao_Paulo",
	hour12: false,
};

export const uploadFile = async (req: MulterRequest, res: Response) => {
	if (!req.file) {
		return res.status(400).send("Nenhum arquivo enviado.");
	}

	// return res.status(400).json(req.file);

	const startDate = new Date();
	const startTime = startDate.toLocaleTimeString("pt-BR", timeOpts);

	const gamesToSearch = [];
	let responseFile: string = "";
	let fullLine: string = "";

	const filePath = req.file.path;
	const fileContent = fs.readFileSync(filePath, "utf8");

	const lines = fileContent.split("\n");

	const minPopularity = Number(lines[0]); // Primeira posição será a popularidade mínima
	lines.shift(); // Retira a popularidade do array

	// Iterar sobre as linhas e armazenar o conteúdo no array gamesToSearch
	for (const line of lines) {
		const trimmedLine: string = line.trim();

		if (trimmedLine !== "") {
			gamesToSearch.push(trimmedLine);
		}
	}

	let foundGames = await searchSteamDb(gamesToSearch);

	foundGames = worthyByPopularity(foundGames, minPopularity);

	foundGames = await searchGamivo(foundGames);

	for (const game of foundGames) {
		fullLine = `G2A\t${game.GamivoPrice}\tKinguin\t\t\t\t${game.popularity}\t${game.name}\n`;
		responseFile += fullLine;
	}

	fs.writeFileSync(filePath, responseFile);

	res.download(filePath, "resultado-price-researcher.txt", (err) => {
		// Verifica se houve algum erro durante o download

		const endDate = new Date();
		const endTime = endDate.toLocaleTimeString("pt-BR", timeOpts);
		const duration = endDate.getTime() - startDate.getTime();

		console.log("⏰ [TIMING] Process completed:", {
			startTime,
			endTime,
			duration: `${duration}ms`,
			durationSeconds: `${(duration / 1000).toFixed(2)}s`,
		});

		if (err) {
			console.error("❌ [DOWNLOAD_ERROR] Error during file download:", err);
			fs.unlinkSync(filePath);
		} else {
			// Se o download for bem-sucedido, exclui o arquivo
			fs.unlinkSync(filePath);
		}
	});

	// return res.status(200).json(responseFile);

	// O for vai passar em todos os gamesToSearch
	// for (let game of gamesToSearch) {
	//     let search = true, fullLine, popularity;
	//     console.log("Game: " + game);
	//     const G2A = await searchG2A(minPopularity, 100, gamesToSearch);
	//     // return res.status(200).json(G2A);

	//     console.log(gamivo);
	//     // return res.status(200).json(popularity);

	//     minPopularity !== 0 ? popularity = await searchSteamDb(game) : popularity = 999;
	//     // let popularity = 2442; // Debug

	//     if (popularity == 'F') continue;

	//     if (popularity < minPopularity) search = false;

	//     //Converte para o formato brasileiro com .
	//     // CHECAR SE É Number
	//     if (!isNumber(popularity)) {
	//         if (popularity.includes(',')) { popularity = popularity.replace(',', '.'); }
	//         let popularityNumber = parseFloat(popularity);
	//         let decimalPlaces = (popularity.split('.')[1] || '').length;
	//         popularity = popularityNumber.toFixed(decimalPlaces);
	//     }

	//     if (popularity <= 0 || !search) continue;

	//     priceGamivo = await searchGamivo(game, minPopularity, popularity);
	//     if (priceGamivo !== 'F' && priceGamivo !== 'N') {
	//         fullLine = `G2A\t${priceGamivo}\tKinguin\t\t\t\t${popularity}\t${game}\n`;
	//         responseFile += fullLine;
	//     }

	//     console.log(fullLine);
	// }

	// console.log("responseFile:\n" + responseFile);

	// // res.json('A'); // DEBUG
	// // return;

	// fs.writeFileSync(filePath, responseFile);

	// res.download(filePath, 'resultado-price-researcher.txt', (err) => {
	//     // Verifica se houve algum erro durante o download

	//     const newHoraAtual = new Date();
	//     const options = { timeZone: 'America/Sao_Paulo', hour12: false };
	//     const hora2 = newHoraAtual.toLocaleTimeString('pt-BR', options);

	//     console.log(`Horário de início: ${hora1}, horário de término: ${hora2}`);
	//     if (err) {
	//         console.error('Erro ao fazer o download do arquivo:', err);
	//         fs.unlinkSync(filePath);
	//     } else {
	//         // Se o download for bem-sucedido, exclui o arquivo
	//         fs.unlinkSync(filePath);
	//     }
	// });
};
