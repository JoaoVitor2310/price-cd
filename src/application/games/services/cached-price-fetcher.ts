import type { FoundGames } from "@/application/games/game.types.js";
import type {
	CatalogPrice,
	CatalogPriceSource,
	PriceFetcher,
	PriceLookup,
} from "@/application/games/ports/game-search.ports.js";
import type {
	CachedPrice,
	PriceCache,
} from "@/application/games/ports/price-cache.port.js";
import {
	getRegion,
	hasEdition,
	normalizeGameName,
	removeRegion,
} from "@/helpers/clear-string.js";

/**
 * A chave identifica o que o AllKeyShop pesquisa: o nome-base, a região e a
 * Edição. "Crysis 2 EU" e "Crysis 2" não se misturam, nem "Crysis 2" e "Crysis 2
 * Remastered"; quantidade (`x2`) fica de fora, porque o preço é por unidade.
 */
export const priceCacheKey = (gameName: string): string =>
	[
		"price",
		normalizeGameName(gameName),
		getRegion(gameName),
		[...hasEdition(gameName)].sort().join("+"),
	].join(":");

/**
 * Só o resultado definitivo vai para o cache. `failed` é transitório e guardá-lo
 * esconderia o jogo pelo TTL inteiro.
 *
 * Um preço com oferta na Gamivo mas sem `gamivo_id` é guardado mesmo assim: a
 * resolução do id não distingue "falhou" de "não há slug", e sem `API_KEY_GAMIVO`
 * ela nunca dá id. Recusar esse caso deixaria fora do cache justamente os jogos
 * com oferta na Gamivo, o caso mais comum. Custo aceito: uma falha transitória
 * na resolução do id fica guardada pelo TTL. Ver ADR 0008.
 */
const isCacheable = (lookup: PriceLookup): lookup is CachedPrice =>
	lookup.status !== "failed";

const withPrice = (game: FoundGames, catalog: CatalogPrice): FoundGames => {
	const region = getRegion(game.name);
	return {
		id: game.id,
		name: removeRegion(game.name),
		foundName: catalog.foundName,
		popularity: game.popularity,
		region: region === "global" ? "" : region.toUpperCase(),
		id_steam: game.id_steam,
		gamivo_id: catalog.gamivo_id,
		hasGamivoOffer: catalog.hasGamivoOffer,
		GamivoPrice: catalog.bestPrice,
	};
};

/**
 * O `PriceFetcher` que o `PriceGames` recebe: consulta o cache e só manda ao
 * catálogo (AllKeyShop) quem não estava lá. Decorator de propósito — o motor não
 * sabe que o cache existe, e "o que é cacheável" fica testável sem Redis.
 * Ver `docs/adr/0008-cache-de-preco-em-redis.md`.
 *
 * Sem `@Injectable()`: `application/` nunca importa `@nestjs/*`.
 */
export class CachedPriceFetcher implements PriceFetcher {
	constructor(
		private readonly source: CatalogPriceSource,
		private readonly cache: PriceCache,
	) {}

	async fetch(games: FoundGames[]): Promise<FoundGames[]> {
		if (games.length === 0) return [];

		// Nomes diferentes podem cair na mesma chave ("Crysis™ 2" e "crysis 2"): o
		// cache e o catálogo trabalham por chave, e cada chave é pesquisada uma vez.
		const nameByKey = new Map<string, string>();
		for (const game of games) {
			const key = priceCacheKey(game.name);
			if (!nameByKey.has(key)) nameByKey.set(key, game.name);
		}

		const lookups = new Map<string, PriceLookup>(
			await this.cache.get([...nameByKey.keys()]),
		);
		for (const [key, hit] of lookups) {
			const shown =
				hit.status === "priced"
					? `€${hit.price.bestPrice.toFixed(2)}`
					: "not found";
			console.log(`💾 [CACHE] hit: ${nameByKey.get(key)} → ${shown}`);
		}

		const misses = [...nameByKey].filter(([key]) => !lookups.has(key));
		if (misses.length > 0) {
			const fresh = await this.source.lookup(misses.map(([, name]) => name));
			const toStore = new Map<string, CachedPrice>();
			for (const [key, name] of misses) {
				const lookup = fresh.get(name);
				if (!lookup) continue;
				lookups.set(key, lookup);
				if (isCacheable(lookup)) toStore.set(key, lookup);
			}
			if (toStore.size > 0) await this.cache.set(toStore);
		}

		return games.flatMap((game) => {
			const lookup = lookups.get(priceCacheKey(game.name));
			return lookup?.status === "priced" ? [withPrice(game, lookup.price)] : [];
		});
	}
}
