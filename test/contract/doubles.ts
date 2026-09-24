/**
 * Dublês dos adaptadores de infraestrutura usados pela bateria de contrato.
 *
 * A costura é `infrastructure/` de propósito: é a camada que **não** migra
 * (`docs/NEST.md` §2), então os mesmos dublês servem ao app Express e ao app
 * Nest sem duplicação. Mockar `controllers/` ou `services/` não serviria — eles
 * morrem no PR 10.
 *
 * Nada aqui abre browser: a bateria de contrato roda em milissegundos e não
 * depende de rede, porque o que ela verifica é forma de resposta HTTP, não
 * scraping. O comportamento do scraping é coberto pelos testes de unidade.
 */

import type { FoundGames } from "@/application/games/game.types.js";
import { CONTRACT_BOOM } from "./contract-cases.js";

/** Um jogo plausível, com preço e popularidade acima de qualquer piso. */
export const contractGame = (name: string, id = 1): FoundGames => ({
	id,
	name,
	foundName: name,
	id_steam: "1145360",
	popularity: 5000,
	region: "ROW",
	GamivoPrice: 4.2,
});

export const popularityFetcherDouble = () => ({
	fetch: async (gameNames: string[], _minPopularity: number) => {
		// O único jeito declarativo de um caso de contrato provocar um 500: sem
		// isso os três formatos de erro interno ficariam sem portão.
		if (gameNames.includes(CONTRACT_BOOM)) {
			throw new Error("contract double: forced failure");
		}
		return gameNames.map((name, index) => contractGame(name, index + 1));
	},
});

export const priceFetcherDouble = () => ({
	fetch: async (games: FoundGames[], _checkGamivoOffer: boolean) => games,
});

export const tradeImporterDouble = () => ({
	import: async () => {},
});

/**
 * Agendador inerte: registra a tarefa e **não a executa**.
 *
 * É o que mantém os casos de 202 honestos — o contrato do endpoint é "aceitei e
 * enfileirei", e rodar a tarefa de verdade arrastaria scraping real para dentro
 * de um teste de contrato.
 */
export const schedulerDouble = () => {
	const scheduled: Array<() => Promise<void>> = [];
	return {
		scheduled,
		schedule: (task: () => Promise<void>) => {
			scheduled.push(task);
		},
	};
};
