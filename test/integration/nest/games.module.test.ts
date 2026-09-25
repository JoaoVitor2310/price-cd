import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	PopularityFetcher,
	PriceFetcher,
} from "@/application/games/ports/game-search.ports.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { SearchGamesUseCase } from "@/application/games/use-cases/search-games.use-case.js";
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

		const moduleRef = await Test.createTestingModule({ imports: [AppConfigModule, GamesModule] })
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

	it("builds SearchGamesUseCase with both ports injected", async () => {
		// O use case não tem `@Injectable()` — `application/` não importa Nest.
		// Este teste prova que o `useFactory` + `inject` do módulo supre isso.
		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, GamesModule],
		}).compile();

		expect(moduleRef.get(SearchGamesUseCase)).toBeInstanceOf(SearchGamesUseCase);
		await moduleRef.close();
	});

	it("replaces the port with a double through the container", async () => {
		popularity.fetch.mockResolvedValueOnce([found("Hades")]);
		price.fetch.mockResolvedValueOnce([found("Hades")]);

		const response = await request(app.getHttpServer())
			.post("/games/search")
			.send({ minPopularity: 0, gameNames: ["Hades"], checkGamivoOffer: false });

		expect(response.status).toBe(200);
		expect(response.body.data.games).toHaveLength(1);
		expect(popularity.fetch).toHaveBeenCalledWith(["Hades"], 0);
		expect(price.fetch).toHaveBeenCalledWith(expect.any(Array), false);
	});

	it("resolves Steam ids and keeps games the fetcher did not find", async () => {
		popularity.fetch.mockResolvedValueOnce([found("Hades")]);

		const response = await request(app.getHttpServer())
			.post("/games/search-id-steam")
			.send({ games: [{ id: 1, name: "Hades" }, { id: 2, name: "Unknown" }] });

		expect(response.status).toBe(200);
		expect(response.body.data.games).toEqual([
			{ id: 1, name: "Hades", id_steam: "1145360" },
			{ id: 2, name: "Unknown" },
		]);
	});

	it("uses the legacy 500 shape of these routes, not the global one", async () => {
		// `message` e "Internal server error" SEM ponto final. O filter global
		// responde `details` e COM ponto — trocar os dois quebraria o contrato.
		popularity.fetch.mockRejectedValueOnce(new Error("scraper died"));

		const response = await request(app.getHttpServer())
			.post("/games/search")
			.send({ minPopularity: 0, gameNames: ["Hades"], checkGamivoOffer: false });

		expect(response.status).toBe(500);
		expect(response.body).toEqual({
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		});
	});

	it("never leaks the underlying error message on a 500", async () => {
		popularity.fetch.mockRejectedValueOnce(new Error("PHPSESSID=secret-cookie"));

		const response = await request(app.getHttpServer())
			.post("/games/search")
			.send({ minPopularity: 0, gameNames: ["Hades"], checkGamivoOffer: false });

		expect(JSON.stringify(response.body)).not.toContain("secret-cookie");
	});

	describe("POST /games/research", () => {
		const body = {
			minPopularity: 0,
			gameNames: ["Hades"],
			checkGamivoOffer: false,
		};

		it("runs synchronously and returns 200 when no token is sent", async () => {
			popularity.fetch.mockResolvedValueOnce([found("Hades")]);
			price.fetch.mockResolvedValueOnce([found("Hades")]);

			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send(body);

			expect(response.status).toBe(200);
			expect(response.body).toMatchObject({ success: true, demo: true });
			// Modo demo nunca cria Trade — é a razão de o modo existir.
			expect(tradeImporter.import).not.toHaveBeenCalled();
		});

		it("returns 200 demo for a wrong token instead of rejecting it", async () => {
			// Este é o caso que proíbe um Guard: Guard devolveria 403, e o
			// contrato manda devolver o resultado demo com 200.
			process.env.INTERNAL_SECRET = "the-real-secret";
			popularity.fetch.mockResolvedValueOnce([]);

			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send({ ...body, internal_secret: "wrong" });

			expect(response.status).toBe(200);
			expect(response.body.demo).toBe(true);
			delete process.env.INTERNAL_SECRET;
		});

		it("reports validation problems in `data`, not in `error`", async () => {
			// Formato legado desta rota, diferente do de `/games/search`.
			const response = await request(app.getHttpServer())
				.post("/games/research")
				.send({ minPopularity: -1, gameNames: ["Hades"] });

			expect(response.status).toBe(400);
			expect(response.body).toEqual({
				success: false,
				data: expect.stringContaining("Invalid file content:"),
			});
			expect(response.body.error).toBeUndefined();
		});
	});
});
