import "reflect-metadata";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import {
	GameSearcher,
	ListTopicFetcherFactory,
} from "@/application/lists/ports/list-run.ports.js";
import { ListsRunQueue } from "@/application/lists/ports/lists-run-queue.port.js";
import { RunListsUseCase } from "@/application/lists/use-cases/run-lists.use-case.js";
import { AppConfigModule } from "@/nest/config/config.module.js";
import { ResearchQueue } from "@/application/games/ports/research-queue.port.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { RESEARCH_RUNNER } from "@/nest/games/games.tokens.js";
import { ListsModule } from "@/nest/lists/lists.module.js";
import { LISTS_RUNNER, MAX_ACTIVE_LISTS } from "@/nest/lists/lists.tokens.js";

const list = (url: string, status: "active" | "inactive", gameNames: string[]) => ({
	topicRef: url,
	url,
	status,
	gameNames,
});

describe("ListsModule", () => {
	let app: NestExpressApplication;
	const enqueued: unknown[] = [];
	const fetcher = {
		fetchUserLists: vi.fn(),
		fetchList: vi.fn(),
		dispose: vi.fn().mockResolvedValue(undefined),
	};
	const gameSearcher = { search: vi.fn().mockResolvedValue([]) };
	const tradeImporter = { import: vi.fn().mockResolvedValue(undefined) };

	beforeAll(async () => {
		process.env.SISTEMA_ESTOQUE_URL = "http://sistema-estoque.test";
		process.env.EXTERNAL_SECRET = "test-external-secret";

		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule, ListsModule],
		})
			.overrideProvider(ListTopicFetcherFactory)
			.useValue({ create: () => fetcher })
			.overrideProvider(GameSearcher)
			.useValue(gameSearcher)
			.overrideProvider(GameTradeImporter)
			.useValue(tradeImporter)
			.overrideProvider(ListsRunQueue)
			.useValue({ enqueue: async (r: unknown) => void enqueued.push(r) })
			.compile();

		app = moduleRef.createNestApplication<NestExpressApplication>();
		await app.init();
	});

	afterAll(async () => {
		await app?.close();
	});

	it("accepts the request and returns 202 without running the work inline", async () => {
		const response = await request(app.getHttpServer())
			.post("/lists/run")
			.send({ steam_id: "76561198000000000" });

		expect(response.status).toBe(202);
		expect(response.body).toEqual({ success: true, status: "queued" });
		expect(enqueued).toEqual([
			{ steam_id: "76561198000000000", checkGamivoOffer: true },
		]);
		// O contrato é "aceitei e enfileirei", não "terminei".
		expect(fetcher.fetchUserLists).not.toHaveBeenCalled();
	});

	it("reports validation problems in `data`, in Portuguese", async () => {
		// Formato legado desta rota, diferente de todas as outras.
		const response = await request(app.getHttpServer())
			.post("/lists/run")
			.send({ steam_id: "" });

		expect(response.status).toBe(400);
		expect(response.body).toEqual({
			success: false,
			data: "Erro no corpo da requisição: steam_id is required",
		});
	});

	describe("the two queues", () => {
		it("never runs a research on the lists queue", async () => {
			// O wiring real, com só as pontas trocadas: a fila de listas vira um
			// espião e o runner da pesquisa um dublê (nada de scraping). A suíte
			// roda sem `QUEUE_REDIS_URL`, então as duas filas são em memória — e a
			// de listas não pode ser a da pesquisa.
			const listsQueue = { enqueue: vi.fn() };
			const researchRunner = { run: vi.fn().mockResolvedValue(undefined) };
			const moduleRef = await Test.createTestingModule({
				imports: [AppConfigModule, ListsModule],
			})
				.overrideProvider(ListsRunQueue)
				.useValue(listsQueue)
				.overrideProvider(RESEARCH_RUNNER)
				.useValue(researchRunner)
				.compile();

			const researchQueue = moduleRef.get(ResearchQueue, { strict: false });
			await researchQueue.enqueue({
				gameNames: ["Hades"],
				criteria: resolveSearchCriteria("default", {}),
			});
			await vi.waitFor(() => expect(researchRunner.run).toHaveBeenCalled());

			// Mesmo scheduler significaria uma execução longa de listas segurando
			// a pesquisa manual de alguém que está esperando na tela — sem erro
			// nenhum aparecer.
			expect(listsQueue.enqueue).not.toHaveBeenCalled();
			await moduleRef.close();
		});
	});

	describe("values that come from configuration", () => {
		/**
		 * Constrói o módulo com um `ConfigService` falso.
		 *
		 * É o que permite provar o wiring sem reconstruir o ambiente:
		 * `ConfigModule.forRoot` resolve a configuração uma vez por processo, então
		 * mexer em `process.env` entre testes não mudaria nada (ver o docblock de
		 * `config.module.ts`).
		 */
		const withConfig = (
			values: Record<string, unknown>,
			runner = { run: vi.fn().mockResolvedValue(undefined) },
		) =>
			Test.createTestingModule({ imports: [AppConfigModule, ListsModule] })
				.overrideProvider(ConfigService)
				.useValue({ get: (key: string) => values[key] })
				.overrideProvider(LISTS_RUNNER)
				.useValue(runner)
				.compile();

		it("takes MAX_ACTIVE_LISTS from config, not from process.env", async () => {
			// Era `Number(process.env.MAX_ACTIVE_LISTS) || 3` dentro do use case —
			// violação de camada. O valor tem que vir do container.
			const moduleRef = await withConfig({ MAX_ACTIVE_LISTS: 7, RUN_LISTS_CONCURRENCY: 1 });

			expect(moduleRef.get(MAX_ACTIVE_LISTS)).toBe(7);
			await moduleRef.close();
		});

		it("builds the lists queue with the configured concurrency", async () => {
			// Prova pelo COMPORTAMENTO, não lendo campo privado: com concorrência 2,
			// dois pedidos devem começar e o terceiro esperar. Sem
			// `QUEUE_REDIS_URL` no config falso, a fila é a em memória.
			let started = 0;
			const runner = {
				run: vi.fn(
					() =>
						new Promise<void>(() => {
							started++;
						}),
				),
			};
			const moduleRef = await withConfig(
				{ MAX_ACTIVE_LISTS: 3, RUN_LISTS_CONCURRENCY: 2 },
				runner,
			);
			const queue = moduleRef.get(ListsRunQueue);
			vi.spyOn(console, "log").mockImplementation(() => {});

			for (const steam_id of ["1", "2", "3"]) {
				await queue.enqueue({ steam_id, checkGamivoOffer: true });
			}
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(started).toBe(2);
			await moduleRef.close();
		});
	});

	describe("the per-execution browser session", () => {
		it("creates a fresh fetcher for every run and disposes it", async () => {
			const created: unknown[] = [];
			const moduleRef = await Test.createTestingModule({
				imports: [AppConfigModule, ListsModule],
			})
				.overrideProvider(ListTopicFetcherFactory)
				.useValue({
					create: () => {
						const made = {
							fetchUserLists: vi.fn().mockResolvedValue([list("u", "active", [])]),
							fetchList: vi.fn().mockResolvedValue(list("u", "inactive", [])),
							dispose: vi.fn().mockResolvedValue(undefined),
						};
						created.push(made);
						return made;
					},
				})
				.overrideProvider(GameSearcher)
				.useValue({ search: vi.fn().mockResolvedValue([]) })
				.overrideProvider(GameTradeImporter)
				.useValue({ import: vi.fn() })
				.compile();

			const useCase = moduleRef.get(RunListsUseCase);
			const run = { steam_id: "1", checkGamivoOffer: false };
			await useCase.execute({ supplierListRequest: run, checkGamivoOffer: false });
			await useCase.execute({ supplierListRequest: run, checkGamivoOffer: false });

			// Duas execuções, duas sessões: compartilhar faria a primeira a
			// terminar fechar o browser da outra.
			expect(created).toHaveLength(2);
			for (const made of created) {
				expect((made as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
			}
			await moduleRef.close();
		});
	});
});
