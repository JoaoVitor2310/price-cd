import type { PriceLookup } from "@/application/games/ports/game-search.ports.js";

/** O que pode ser guardado: preço ou "não tem". Falha transitória nunca é. */
export type CachedPrice = Exclude<PriceLookup, { status: "failed" }>;

export type PriceCacheStatus = "up" | "down" | "disabled";

/**
 * O cache de preço do catálogo. Ver `docs/adr/0008-cache-de-preco-em-redis.md`.
 *
 * O contrato é **fail-open**: quem implementa nunca lança. Se o armazenamento não
 * responde, `get` devolve as chaves como miss e `set` não grava — a pesquisa fica
 * lenta como sem cache, mas não para. O TTL é configuração do adapter.
 */
export abstract class PriceCache {
	/** Só as chaves encontradas aparecem no mapa; ausência é miss. */
	abstract get(keys: string[]): Promise<Map<string, CachedPrice>>;
	abstract set(entries: Map<string, CachedPrice>): Promise<void>;
	/**
	 * Para o health: `up` respondendo, `down` configurado mas fora do ar,
	 * `disabled` sem cache configurado.
	 */
	abstract status(): Promise<PriceCacheStatus>;
}
