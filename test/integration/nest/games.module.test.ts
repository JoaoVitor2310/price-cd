import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	CatalogPriceSource,
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { PriceCache } from "@/application/games/ports/price-cache.port.js";
import { ResearchQueue } from "@/application/games/ports/research-queue.port.js";
import { ResearchResultNotifier } from "@/application/games/ports/research-result-notifier.port.js";
import { TradeWithOfferCreator } from "@/application/games/ports/trade-with-offer-creator.port.js";
import { RunResearchJobUseCase } from "@/application/games/use-cases/run-research-job.use-case.js";
import { InMemoryWebhookNotifier } from "@/infrastructure/background/in-memory-webhook-notifier.js";
import { LazyTradeWithOfferCreator } from "@/infrastructure/games/lazy-trade-with-offer-creator.js";
import { RESEARCH_RUNNER } from "@/nest/games/games.tokens.js";
import { CachedPriceFetcher } from "@/application/games/services/cached-price-fetcher.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { CreateResearchTrade } from "@/application/games/services/create-research-trade.js";
import { ResearchGamesUseCase } from "@/application/games/use-cases/research-games.use-case.js";
import { InMemoryResearchQueue } from "@/infrastructure/background/in-memory-research-queue.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { NoopPriceCache } from "@/infrastructure/games/noop-price-cache.js";
import { RedisPriceCache } from "@/infrastructure/games/redis-price-cache.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { GamesModule } from "@/nest/games/games.module.js";

const found = (name: string, id = 1) => ({
	id,
	name,
	id_steam: "1145360",
	popularity: 5000,
	region: "ROW",
	GamivoPrice: 4.2,
});

/**
 * `AppConfigModule` entra em todo `createTestingModule` porque `GamesModule`
 * depende do `ConfigService` (o `HttpGameTradeImporter` precisa de URL e
 * secret). `isGlobal: true` dispensa o import em produção, mas não faz o
 * provider existir num grafo de teste que não o inclua.
 */
describe("GamesModule", () => {
	let app: NestExpressApplication;
	const popularity = { fetch: vi.fn() };
	const price = { fetch: vi.fn() };
	const tradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

	beforeAll(async () => {
		// Nunca dependa do `.env` da máquina: em CI ele não existe.
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
		process.env.EXTERNAL_SECRET = "test-external-secret";

		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		})
			.overrideProvider(PopularityFetcher)
			.useValue(popularity)
			.overrideProvider(PriceFetcher)
			.useValue(price)
			.overrideProvider(GameTradeImporter)
			.useValue(tradeImporter)
			.compile();

		app = moduleRef.createNestApplication<NestExpressApplication>();
		await app.init();
	});

	afterAll(async () => {
		await app?.close();
	});

	it("wires the real adapter behind the port token by default", async () => {
		// Sem override: quem pede a porta recebe a implementação de
		// `infrastructure/`. É o que prova que o módulo está registrando o token,
		// e não que o teste está montando tudo por conta própria.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		expect(moduleRef.get(PopularityFetcher)).toBeInstanceOf(
			SteamChartsPopularityFetcher,
		);
		await moduleRef.close();
	});

	it("puts the price cache in front of the AllKeyShop", async () => {
		// O motor recebe o decorator; o AllKeyShop fica atrás da porta do catálogo.
		// Sem `REDIS_URL` (o caso da suíte), o cache é o no-op.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		expect(moduleRef.get(PriceFetcher)).toBeInstanceOf(CachedPriceFetcher);
		expect(moduleRef.get(CatalogPriceSource)).toBeInstanceOf(
			AllKeyShopPriceFetcher,
		);
		expect(moduleRef.get(PriceCache)).toBeInstanceOf(NoopPriceCache);
		await moduleRef.close();
	});

	it("uses the Redis cache when REDIS_URL is set, without waiting for Redis to boot", async () => {
		// Porta onde ninguém escuta: o boot tem que completar mesmo assim.
		// Restaurado no `finally`: se uma asserção falhar, o `REDIS_URL` não pode
		// vazar para os testes seguintes.
		vi.stubEnv("REDIS_URL", "redis://127.0.0.1:1");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			vi.resetModules();
			const { GamesModule: FreshGamesModule } = await import(
				"@/nest/games/games.module.js"
			);
			const { AppConfigModule: FreshConfigModule } = await import(
				"@/nest/config/config.module.js"
			);
			const ports = await import(
				"@/application/games/ports/price-cache.port.js"
			);
			const redis = await import("@/infrastructure/games/redis-price-cache.js");

			const moduleRef = await Test.createTestingModule({
				imports: [FreshConfigModule, FreshGamesModule],
			}).compile();
			try {
				const cache = moduleRef.get(ports.PriceCache);

				expect(cache).toBeInstanceOf(redis.RedisPriceCache);
				expect(await cache.status()).toBe("down");
			} finally {
				await moduleRef.close();
			}
		} finally {
			vi.unstubAllEnvs();
			warn.mockRestore();
		}
	});

	it("queues research in memory when QUEUE_REDIS_URL is not set", async () => {
		// O caso da suíte e do dev sem Docker. Em produção o schema exige a URL.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		const queue = moduleRef.get(ResearchQueue);
		expect(queue).toBeInstanceOf(InMemoryResearchQueue);
		expect(await queue.status()).toBe("in-memory");
		// O par sem Redis: webhook em memória, uma tentativa.
		expect(moduleRef.get(ResearchResultNotifier)).toBeInstanceOf(
			InMemoryWebhookNotifier,
		);
		await moduleRef.close();
	});

	it("runs each queued request through RunResearchJobUseCase, with the Trade with an offer built lazily", async () => {
		// Sem `SISTEMA_ESTOQUE_URL` na suíte: construir o adapter no boot
		// derrubaria o módulo, e o demo precisa subir sem o Estoque.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		expect(moduleRef.get(RESEARCH_RUNNER)).toBeInstanceOf(
			RunResearchJobUseCase,
		);
		expect(moduleRef.get(TradeWithOfferCreator)).toBeInstanceOf(
			LazyTradeWithOfferCreator,
		);
		await moduleRef.close();
	});

	it("accepts a webhook only to a host listed in WEBHOOK_ALLOWED_HOSTS", async () => {
		// O ambiente é validado no import do ConfigModule: precisa estar no lugar
		// antes de importar.
		vi.stubEnv("WEBHOOK_ALLOWED_HOSTS", "chatbot");
		vi.stubEnv("WEBHOOK_SIGNING_SECRET", "s".repeat(32));
		try {
			vi.resetModules();
			const { GamesModule: FreshGamesModule } = await import(
				"@/nest/games/games.module.js"
			);
			const { AppConfigModule: FreshConfigModule } = await import(
				"@/nest/config/config.module.js"
			);
			const ports = await import(
				"@/application/games/ports/research-queue.port.js"
			);
			const enqueue = await import(
				"@/application/games/use-cases/enqueue-research-games.use-case.js"
			);
			const queue = {
				enqueue: vi.fn().mockResolvedValue(undefined),
				previousRun: vi.fn().mockResolvedValue("none"),
				forget: vi.fn(),
				status: vi.fn(),
			};

			const moduleRef = await Test.createTestingModule({
				imports: [FreshConfigModule, FreshGamesModule],
			})
				.overrideProvider(ports.ResearchQueue)
				.useValue(queue)
				.compile();
			try {
				const useCase = moduleRef.get(enqueue.EnqueueResearchGamesUseCase);
				const request = (webhookUrl: string) => ({
					request: {
						gameNames: ["Hades"],
						criteria: {
							popularity: {
								upToThreshold: 0,
								aboveThreshold: 0,
								priceThresholdEuro: 5,
							},
							lookupPopularity: false,
							minPrice: 0.5,
							checkGamivoOffer: false,
						},
						currency: "eur" as const,
						supplierSteamId: "76561198012345678",
						requestUuid: "8c1f0000-0000-4000-8000-000000000000",
						webhookUrl,
					},
				});

				await useCase.execute(request("http://chatbot:3000/webhooks/price-cd"));
				expect(queue.enqueue).toHaveBeenCalledTimes(1);

				await expect(
					useCase.execute(request("http://estoque:8000/")),
				).rejects.toBeInstanceOf(enqueue.InvalidResearchRequestError);
			} finally {
				await moduleRef.close();
			}
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("uses the durable queue when QUEUE_REDIS_URL is set, booting and closing without Redis", async () => {
		// Porta onde ninguém escuta. O boot não espera o Redis, e o `close` não
		// pode ficar pendurado nas conexões que tentam reconectar — senão um
		// deploy com o Redis da fila fora travaria o desligamento.
		vi.stubEnv("QUEUE_REDIS_URL", "redis://127.0.0.1:1");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			vi.resetModules();
			const { GamesModule: FreshGamesModule } = await import(
				"@/nest/games/games.module.js"
			);
			const { AppConfigModule: FreshConfigModule } = await import(
				"@/nest/config/config.module.js"
			);
			const ports = await import(
				"@/application/games/ports/research-queue.port.js"
			);
			const bullmq = await import(
				"@/infrastructure/background/bullmq-research-queue.js"
			);

			const moduleRef = await Test.createTestingModule({
				imports: [FreshConfigModule, FreshGamesModule],
			}).compile();
			try {
				const queue = moduleRef.get(ports.ResearchQueue);

				expect(queue).toBeInstanceOf(bullmq.BullmqResearchQueue);
				// A entrega do webhook também fica durável, no mesmo Redis.
				const notifier = await import(
					"@/application/games/ports/research-result-notifier.port.js"
				);
				const webhooks = await import(
					"@/infrastructure/background/bullmq-webhook-queue.js"
				);
				expect(moduleRef.get(notifier.ResearchResultNotifier)).toBeInstanceOf(
					webhooks.BullmqWebhookQueue,
				);
				expect(await queue.status()).toBe("down");
				// O pedido é recusado na hora, não pendurado até o Redis voltar.
				await expect(
					queue.enqueue({
						gameNames: ["Hades"],
						criteria: {
							popularity: {
								upToThreshold: 0,
								aboveThreshold: 0,
								priceThresholdEuro: 5,
							},
							lookupPopularity: false,
							minPrice: 0.5,
							checkGamivoOffer: false,
						},
					}),
				).rejects.toThrow();
			} finally {
				await moduleRef.close();
			}
		} finally {
			vi.unstubAllEnvs();
			warn.mockRestore();
		}
	});

	it("builds the research use case and service with their dependencies injected", async () => {
		// Nenhum dos dois tem `@Injectable()` — `application/` não importa Nest.
		// Este teste prova que o `useFactory` + `inject` do módulo supre isso.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		expect(moduleRef.get(ResearchGamesUseCase)).toBeInstanceOf(
			ResearchGamesUseCase,
		);
		expect(moduleRef.get(CreateResearchTrade)).toBeInstanceOf(
			CreateResearchTrade,
		);
		await moduleRef.close();
	});

	it("replaces the port with a double through the container", async () => {
		popularity.fetch.mockResolvedValueOnce([found("Hades")]);
		price.fetch.mockResolvedValueOnce({
			games: [found("Hades")],
			failed: [],
		});

		const response = await request(app.getHttpServer())
			.post("/games/research")
			.send({ gameNames: ["Hades"], preset: "bundle-sync" });

		expect(response.status).toBe(200);
		expect(response.body.games).toHaveLength(1);
		// `bundle-sync` tem `lookupPopularity: false`: o fetcher é chamado com
		// `lookup: false`, ou seja, sem consultar o SteamCharts.
		expect(popularity.fetch).toHaveBeenCalledWith(["Hades"], false);
		// O preço vai sem o critério de Gamivo: o corte é do domínio, depois
		// do cache (ADR 0008).
		expect(price.fetch).toHaveBeenCalledWith(expect.any(Array));
	});

	it("bundle-research returns a game SteamCharts does not know, with popularity 0", async () => {
		// O fornecedor vende o bundle inteiro: o jogo que o SteamCharts não devolve
		// tem que voltar, e a consulta acontece (`lookup: true`) para informar o número.
		popularity.fetch.mockResolvedValueOnce([found("Hades")]);
		price.fetch.mockResolvedValueOnce({
			games: [
			found("Hades"),
			{ ...found("Obscure Indie"), id: 1, popularity: 0 },
		],
			failed: [],
		});

		const response = await request(app.getHttpServer())
			.post("/games/research")
			.send({
				gameNames: ["Hades", "Obscure Indie"],
				preset: "bundle-research",
			});

		expect(response.status).toBe(200);
		expect(popularity.fetch).toHaveBeenCalledWith(
			["Hades", "Obscure Indie"],
			true,
		);
		const sentToPricing = price.fetch.mock.lastCall?.[0] as Array<{
			name: string;
		}>;
		expect(sentToPricing.map((game) => game.name)).toEqual([
			"Hades",
			"Obscure Indie",
		]);
		expect(
			response.body.games.map((game: { name: string }) => game.name),
		).toEqual(["Hades", "Obscure Indie"]);
	});

	it("resolves Steam ids and keeps games the fetcher did not find", async () => {
		popularity.fetch.mockResolvedValueOnce([found("Hades")]);

		const response = await request(app.getHttpServer())
			.post("/games/search-id-steam")
			.send({
				games: [
					{ id: 1, name: "Hades" },
					{ id: 2, name: "Unknown" },
				],
			});

		expect(response.status).toBe(200);
		expect(response.body.data.games).toEqual([
			{ id: 1, name: "Hades", id_steam: "1145360" },
			{ id: 2, name: "Unknown" },
		]);
	});

	it("uses the legacy 500 shape of search-id-steam, not the global one", async () => {
		// `message` e "Internal server error" SEM ponto final. O filter global
		// responde `details` e COM ponto — trocar os dois quebraria o contrato.
		popularity.fetch.mockRejectedValueOnce(new Error("scraper died"));

		const response = await request(app.getHttpServer())
			.post("/games/search-id-steam")
			.send({ games: [{ id: 1, name: "Hades" }] });

		expect(response.status).toBe(500);
		expect(response.body).toEqual({
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		});
	});

	it("never leaks the underlying error message on a 500", async () => {
		popularity.fetch.mockRejectedValueOnce(
			new Error("PHPSESSID=secret-cookie"),
		);

		const response = await request(app.getHttpServer())
			.post("/games/search-id-steam")
			.send({ games: [{ id: 1, name: "Hades" }] });

		expect(JSON.stringify(response.body)).not.toContain("secret-cookie");
	});

	describe("POST /games/research", () => {
		const body = { gameNames: ["Hades"], preset: "bundle-sync" };

		it("runs synchronously and returns 200 when no token is sent", async () => {
			popularity.fetch.mockResolvedValueOnce([found("Hades")]);
			price.fetch.mockResolvedValueOnce({
			games: [found("Hades")],
			failed: [],
		});

			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send(body);

			expect(response.status).toBe(200);
			expect(response.body).toMatchObject({ success: true, demo: true });
			// Modo demo nunca cria Trade — é a razão de o modo existir.
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});

		it("names the market price `market_price_euro` in the demo games", async () => {
			// `public/index.html` lê este nome: trocá-lo só de um lado deixaria a
			// coluna de preço da UI em `NaN`. O nome antigo não pode voltar.
			popularity.fetch.mockResolvedValueOnce([found("Hades")]);
			price.fetch.mockResolvedValueOnce({
			games: [found("Hades")],
			failed: [],
		});

			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send(body);

			expect(response.body.games).toHaveLength(1);
			expect(response.body.games[0]).toMatchObject({
				name: "Hades",
				market_price_euro: 4.2,
			});
			expect(response.body.games[0]).not.toHaveProperty("price_euro");
		});

		it("returns 200 demo for a wrong token instead of rejecting it", async () => {
			// Este é o caso que proíbe um Guard: Guard devolveria 403, e o
			// contrato manda devolver o resultado demo com 200.
			process.env.INTERNAL_SECRET = "the-real-secret";
			// `bundle-sync` não consulta o SteamCharts: o fetcher real devolveria todo
			// jogo (popularidade 0), nunca uma lista vazia.
			popularity.fetch.mockResolvedValueOnce([found("Hades")]);
			price.fetch.mockResolvedValueOnce({
			games: [found("Hades")],
			failed: [],
		});

			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send({ ...body, internal_secret: "wrong" });

			expect(response.status).toBe(200);
			expect(response.body.demo).toBe(true);
			delete process.env.INTERNAL_SECRET;
		});

		it("reports validation problems in `data`, not in `error`", async () => {
			// Formato legado desta rota, diferente do de `/games/search-id-steam`.
			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send({ minPrice: -1, gameNames: ["Hades"] });

			expect(response.status).toBe(400);
			expect(response.body).toEqual({
				success: false,
				data: expect.stringContaining("Invalid file content:"),
			});
			expect(response.body.error).toBeUndefined();
		});
	});
});
