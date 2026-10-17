import type {
	FoundGames,
	GameAnalysisResult,
	SearchGamesRequest,
} from "@/application/games/game.types.js";

/**
 * Portas da busca de jogos.
 *
 * São `abstract class` e não `interface` por uma razão concreta: interface de
 * TypeScript não existe em runtime, e o container de DI do Nest precisa de um
 * **valor** para usar como token de injeção. Uma classe abstrata é esse valor —
 * serve de tipo na compilação e de token em runtime, sem obrigar `application/`
 * a importar `@nestjs/*` (fronteira do `CLAUDE.md` e do ADR 0004).
 *
 * Os adapters continuam usando `implements`, não `extends`: em TypeScript uma
 * classe abstrata também funciona como contrato de `implements`, então nada de
 * herança real acontece aqui.
 *
 * Ver `docs/nest-conceitos.md` §3.
 */
export abstract class PopularityFetcher {
	/**
	 * Com `lookup: false` não consulta nada e devolve todo jogo com popularidade 0.
	 * Com `true`, consulta e omite quem não foi encontrado. **Não filtra** por
	 * popularidade mínima — isso é regra de domínio, aplicada por quem chama.
	 *
	 * Era um `minPopularity: number` em que só importava se o valor era 0: o
	 * número em si nunca era usado, e quem chamava precisava inventar um `1` para
	 * forçar a consulta.
	 */
	abstract fetch(gameNames: string[], lookup: boolean): Promise<FoundGames[]>;
}

export abstract class PriceFetcher {
	abstract fetch(
		games: FoundGames[],
		checkGamivoOffer: boolean,
	): Promise<FoundGames[]>;
}

/** Ainda `interface`: só vira token quando os PRs 5 e 6 migrarem lists/suppliers. */
export interface GameSearcher {
	search(request: SearchGamesRequest): Promise<GameAnalysisResult>;
}
