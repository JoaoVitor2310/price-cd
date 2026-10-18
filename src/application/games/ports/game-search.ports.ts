import type { FoundGames } from "@/application/games/game.types.js";

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
	 * Com `true`, consulta e omite quem não foi encontrado — ou cuja consulta falhou,
	 * que o SteamCharts não distingue de "não existe". **Não filtra** por popularidade
	 * mínima nem decide o destino de quem foi omitido: isso é regra de domínio,
	 * aplicada por quem chama (`withUnratedGames`).
	 *
	 * Vem de `criteria.lookupPopularity`, não dos tiers: quem corta por popularidade
	 * e quem consulta são decisões separadas.
	 */
	abstract fetch(gameNames: string[], lookup: boolean): Promise<FoundGames[]>;
}

export abstract class PriceFetcher {
	abstract fetch(
		games: FoundGames[],
		checkGamivoOffer: boolean,
	): Promise<FoundGames[]>;
}
