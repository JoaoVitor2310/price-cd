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

/**
 * O que o `PriceGames` pede: jogos → os mesmos jogos com preço, omitindo quem
 * ficou sem preço.
 *
 * Não recebe mais `checkGamivoOffer`: o preço volta sempre, com `hasGamivoOffer`,
 * e o corte é do domínio (`partitionByGamivoOffer`). Quem implementa é o
 * `CachedPriceFetcher`, que consulta o cache antes do catálogo.
 */
export abstract class PriceFetcher {
	abstract fetch(games: FoundGames[]): Promise<FoundGames[]>;
}

/** O que o catálogo (AllKeyShop) sabe do preço de um jogo, sem filtro de preset. */
export type CatalogPrice = {
	/** Melhor preço da região/Edição pedidas, em euros (`detectOfferTooLow` já aplicado). */
	bestPrice: number;
	hasGamivoOffer: boolean;
	gamivo_id?: string;
	/** O nome do produto no AllKeyShop. */
	foundName: string;
};

/**
 * O resultado da busca de um jogo no catálogo.
 *
 * - `priced`: achou preço.
 * - `not-found`: o catálogo respondeu que não tem — sem resultado, sem match, ou
 *   sem a região, a Edição ou oferta pedida. Definitivo: pode ir para o cache.
 * - `failed`: não conseguimos perguntar (timeout, Cloudflare, HTML inesperado).
 *   Transitório: nunca vai para o cache, senão esconderia o jogo pelo TTL.
 */
export type PriceLookup =
	| { status: "priced"; price: CatalogPrice }
	| { status: "not-found" }
	| { status: "failed" };

/**
 * A busca de preço no catálogo, um resultado por nome pedido.
 *
 * Separada do `PriceFetcher` porque o cache precisa distinguir "não tem" de "não
 * consegui perguntar", e o `PriceGames` não precisa saber de nenhum dos dois.
 * Erro fatal (browser morto) continua sendo lançado, como antes.
 */
export abstract class CatalogPriceSource {
	abstract lookup(gameNames: string[]): Promise<Map<string, PriceLookup>>;
}
