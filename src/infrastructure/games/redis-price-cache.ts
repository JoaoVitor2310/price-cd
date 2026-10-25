import { createClient } from "redis";
import * as z from "zod";
import type {
	CachedPrice,
	PriceCache,
	PriceCacheStatus,
} from "@/application/games/ports/price-cache.port.js";

/**
 * O pedaço do cliente `redis` que o cache usa. Estreito de propósito: os testes
 * passam um dublê com estes três métodos, sem Redis de verdade.
 */
export type RedisPriceCacheClient = {
	mGet(keys: string[]): Promise<(string | null)[]>;
	set(
		key: string,
		value: string,
		options: { expiration: { type: "EX"; value: number } },
	): Promise<unknown>;
	ping(): Promise<unknown>;
	close(): Promise<unknown>;
};

/** Comando que não volta nisso vira miss: o cache nunca pode atrasar a pesquisa. */
const COMMAND_TIMEOUT_MS = 500;

/**
 * O que está no Redis pode ter sido gravado por outra versão do código (o Redis
 * sobrevive ao deploy) ou editado à mão. Entrada que não casa vira miss, nunca
 * um preço inventado.
 */
const cachedPriceSchema = z.discriminatedUnion("status", [
	z.object({
		status: z.literal("priced"),
		price: z.object({
			bestPrice: z.number(),
			hasGamivoOffer: z.boolean(),
			gamivo_id: z.string().optional(),
			foundName: z.string(),
		}),
	}),
	z.object({ status: z.literal("not-found") }),
]);

const parseEntry = (raw: string | null): CachedPrice | null => {
	if (raw == null) return null;
	try {
		const parsed = cachedPriceSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
};

/**
 * O cache de preço no Redis. Ver `docs/adr/0008-cache-de-preco-em-redis.md`.
 *
 * **Fail-open:** nenhum método lança. O cliente é criado com
 * `disableOfflineQueue` e timeout por comando (`createRedisClient`), então com o
 * Redis fora o comando falha na hora em vez de ficar pendurado, e aqui a falha
 * vira miss (leitura) ou escrita ignorada. O aviso sai só na transição de
 * "respondendo" para "fora", e de volta — um warn por jogo inundaria o log.
 */
export class RedisPriceCache implements PriceCache {
	private up = true;

	constructor(
		private readonly client: RedisPriceCacheClient,
		private readonly ttlSeconds: number,
	) {}

	async get(keys: string[]): Promise<Map<string, CachedPrice>> {
		const found = new Map<string, CachedPrice>();
		if (keys.length === 0) return found;

		try {
			const values = await this.client.mGet(keys);
			this.reportUp();
			keys.forEach((key, index) => {
				const entry = parseEntry(values[index] ?? null);
				if (entry) found.set(key, entry);
			});
		} catch (error) {
			this.reportDown("read", error);
		}

		return found;
	}

	async set(entries: Map<string, CachedPrice>): Promise<void> {
		if (entries.size === 0) return;

		try {
			await Promise.all(
				[...entries].map(([key, value]) =>
					this.client.set(key, JSON.stringify(value), {
						expiration: { type: "EX", value: this.ttlSeconds },
					}),
				),
			);
			this.reportUp();
		} catch (error) {
			this.reportDown("write", error);
		}
	}

	async status(): Promise<PriceCacheStatus> {
		try {
			await this.client.ping();
			this.reportUp();
			return "up";
		} catch (error) {
			this.reportDown("ping", error);
			return "down";
		}
	}

	/**
	 * Chamado pelo próprio Nest no desligamento (o container chama o hook em todo
	 * provider que o tem). Sem isso o socket aberto segura o processo.
	 */
	async onApplicationShutdown(): Promise<void> {
		try {
			await this.client.close();
		} catch {
			// Já estava fechado ou fora do ar — nada a liberar.
		}
	}

	/** Público para os eventos de conexão do cliente (`createRedisPriceCache`). */
	reportUp(): void {
		if (this.up) return;
		this.up = true;
		console.log("💾 [CACHE] Redis is responding again — price cache back on.");
	}

	reportDown(operation: string, error: unknown): void {
		if (!this.up) return;
		this.up = false;
		const reason = error instanceof Error ? error.message : String(error);
		console.warn(
			`⚠️ [CACHE] Redis ${operation} failed (${reason}) — searching without the price cache until it responds.`,
		);
	}
}

/**
 * Cria o cliente e o cache. **Não espera a conexão**: o boot não depende do
 * Redis, e com ele fora o app sobe e pesquisa sem cache.
 *
 * - `disableOfflineQueue`: com o Redis reconectando, o comando falha na hora. O
 *   default enfileiraria, e a pesquisa ficaria pendurada esperando o Redis voltar.
 * - `commandOptions.timeout`: Redis lento também vira miss.
 * - `reconnectStrategy`: tenta de novo para sempre, espaçando até 30s.
 * - O listener de `error` é obrigatório: sem ele o `EventEmitter` lança e
 *   derruba o processo na primeira queda do Redis.
 */
export const createRedisPriceCache = (
	url: string,
	ttlSeconds: number,
): RedisPriceCache => {
	const client = createClient({
		url,
		disableOfflineQueue: true,
		commandOptions: { timeout: COMMAND_TIMEOUT_MS },
		socket: {
			connectTimeout: 2000,
			reconnectStrategy: (retries) => Math.min(500 * 2 ** retries, 30_000),
		},
	});
	const cache = new RedisPriceCache(
		client as unknown as RedisPriceCacheClient,
		ttlSeconds,
	);

	client.on("error", (error) => cache.reportDown("connection", error));
	client.on("ready", () => cache.reportUp());
	client.connect().catch((error) => cache.reportDown("connection", error));

	return cache;
};
