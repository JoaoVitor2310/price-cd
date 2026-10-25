import type {
	CachedPrice,
	PriceCache,
	PriceCacheStatus,
} from "@/application/games/ports/price-cache.port.js";

/**
 * O cache quando `REDIS_URL` não está configurada: tudo é miss, nada é gravado.
 *
 * É o que deixa `npm run dev` fora do Docker e a suíte de testes rodarem sem
 * Redis. O health mostra `cache: "disabled"`, para ninguém achar que há cache onde
 * não há — nem confundir com o Redis fora do ar (`down`).
 */
export class NoopPriceCache implements PriceCache {
	async get(_keys: string[]): Promise<Map<string, CachedPrice>> {
		return new Map();
	}

	async set(_entries: Map<string, CachedPrice>): Promise<void> {}

	async status(): Promise<PriceCacheStatus> {
		return "disabled";
	}
}
