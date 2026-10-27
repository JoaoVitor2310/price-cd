import { expect } from "vitest";

/**
 * O contrato HTTP da API, como ele é HOJE — não como ele deveria ser.
 *
 * É o que o Sistema Estoque consome: status codes, formato das respostas e das
 * mensagens de erro. Teste unitário não passa pelo HTTP, então uma mudança como
 * devolver 201 em vez de 200, ou tirar o `demo: true` do lugar, só seria notada
 * quando o Sistema Estoque quebrasse em produção. `route-coverage.contract.test.ts`
 * garante que toda rota de negócio tenha pelo menos um caso aqui.
 *
 * As inconsistências de formato entre controllers estão **congeladas de
 * propósito**: `/games/research` devolve a mensagem de erro em `data`,
 * `/games/search-id-steam` devolve em `error` + `details`, `/suppliers/find-new` nem tem
 * campo `success` no 500, e "Internal server error" aparece com e sem ponto
 * final. Uniformizar é o item 15 do `docs/IMPROVEMENTS.md`: uma mudança de
 * contrato deliberada, num PR próprio que atualiza esta tabela junto — nunca um
 * efeito colateral de outra mudança.
 *
 * Nasceu como o portão da migração Express → Nest (a mesma bateria rodou contra
 * os dois apps até a paridade estar provada); o git guarda essa história.
 */

export type HttpMethod = "get" | "post";

export type ContractCase = {
	/** Rota exata, do jeito que o cliente chama. */
	route: string;
	method: HttpMethod;
	/** O que este caso prova. Aparece no nome do teste. */
	name: string;
	body?: unknown;
	headers?: Record<string, string>;
	expectStatus: number;
	/** Comparado com `toMatchObject` — subconjunto, não igualdade. */
	expectBody?: Record<string, unknown>;
	/** Para respostas que não são JSON. Comparado por `toContain`. */
	expectText?: string;
	/**
	 * Variáveis de ambiente que este caso exige. O harness as aplica antes da
	 * chamada e restaura depois — `/games/research` muda de comportamento
	 * conforme `INTERNAL_SECRET`, e isso é parte do contrato.
	 */
	env?: Record<string, string | undefined>;
};

/** Token usado nos casos autenticados. Precisa bater com o `env` do caso. */
export const CONTRACT_SECRET = "contract-secret";

/**
 * Nome de jogo que faz o dublê do SteamCharts explodir (`doubles.ts`).
 *
 * Existe porque cada grupo de rotas responde o 500 num formato diferente, e sem
 * um jeito declarativo de provocar a falha não haveria como travar esses formatos.
 */
export const CONTRACT_BOOM = "__contract_boom__";

const VALID_RESEARCH_BODY = {
	gameNames: ["Hades"],
	preset: "bundle-sync",
};

export const CONTRACT_CASES: ContractCase[] = [
	// ------------------------------------------------------------------ GET /
	{
		route: "/",
		method: "get",
		name: "serves public/index.html",
		expectStatus: 200,
		// A página vem do `useStaticAssets` em `src/nest/configure-app.ts`. Uma
		// rota registrada em `/` passaria na frente dela sem ninguém notar.
		expectText: "<!DOCTYPE html>",
	},

	// ------------------------------------------ POST /api/games/search-id-steam
	{
		route: "/api/games/search-id-steam",
		method: "post",
		name: "valid body returns success and data.games",
		body: { games: [{ id: 1, name: "Hades" }] },
		expectStatus: 200,
		expectBody: { success: true, data: { games: [{ id: 1, name: "Hades" }] } },
	},
	{
		route: "/api/games/search-id-steam",
		method: "post",
		name: "empty games returns 400 with error and details",
		body: { games: [] },
		expectStatus: 400,
		expectBody: {
			success: false,
			error: "Validation failed",
			details: "games: At least one game is required",
		},
	},

	{
		route: "/api/games/search-id-steam",
		method: "post",
		name: "empty body returns 400",
		body: {},
		expectStatus: 400,
		expectBody: { success: false, error: "Validation failed" },
	},

	// ------------------------------------------------ GET /api/games/presets
	{
		route: "/api/games/presets",
		method: "get",
		name: "lists every search preset with its criteria",
		expectStatus: 200,
		expectBody: {
			success: true,
			presets: {
				default: {
					label: "Default",
					popularity: { upToThreshold: 30, aboveThreshold: 100, priceThresholdEuro: 5 },
					lookupPopularity: true,
					minPrice: 0.5,
					checkGamivoOffer: true,
				},
				"bundle-research": expect.objectContaining({
					label: "Bundle Research",
					lookupPopularity: true,
				}),
				"bundle-sync": expect.any(Object),
			},
		},
	},

	// ----------------------------------------------- POST /api/games/research
	{
		route: "/api/games/research",
		method: "post",
		name: "no internal_secret returns 200 demo, not 401",
		body: VALID_RESEARCH_BODY,
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "wrong internal_secret returns 200 demo, not 403",
		body: { ...VALID_RESEARCH_BODY, internal_secret: "wrong-secret" },
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "correct internal_secret returns 202 queued",
		body: { ...VALID_RESEARCH_BODY, internal_secret: CONTRACT_SECRET },
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 202,
		expectBody: { success: true, status: "queued" },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "unset INTERNAL_SECRET returns 200 demo even with a token",
		body: { ...VALID_RESEARCH_BODY, internal_secret: CONTRACT_SECRET },
		env: { INTERNAL_SECRET: undefined },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "only gameNames is required: every criterion comes from the default preset",
		body: { gameNames: ["Hades"] },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "negative minPrice returns 400 with the message in `data`, not `error`",
		body: { ...VALID_RESEARCH_BODY, minPrice: -1 },
		expectStatus: 400,
		expectBody: {
			success: false,
			data: "Invalid file content: minPrice must be 0 or greater",
		},
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "token + delivery respond returns 200 with the games and no demo flag",
		body: {
			gameNames: ["Hades"],
			preset: "bundle-sync",
			delivery: "respond",
			internal_secret: CONTRACT_SECRET,
		},
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, games: expect.any(Array) },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "delivery respond without a token is still the capped demo",
		body: { gameNames: ["Hades"], delivery: "respond" },
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "popularity tiers and a preset are accepted together",
		body: {
			gameNames: ["Hades"],
			preset: "default",
			popularity: { upToThreshold: 30, aboveThreshold: 30, priceThresholdEuro: 5 },
			minPrice: 0,
		},
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "lookupPopularity is accepted next to the popularity tiers",
		body: { ...VALID_RESEARCH_BODY, lookupPopularity: false },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "a non-boolean lookupPopularity returns 400",
		body: { ...VALID_RESEARCH_BODY, lookupPopularity: "yes" },
		expectStatus: 400,
		expectBody: { success: false },
	},
	{
		route: "/api/games/research",
		method: "post",
		// O atalho da migração para os presets saiu: hoje é campo desconhecido.
		name: "minPopularity is no longer accepted and returns 400",
		body: { gameNames: ["Hades"], minPopularity: 30 },
		expectStatus: 400,
		expectBody: {
			success: false,
			data: expect.stringContaining("minPopularity"),
		},
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "an unknown preset returns 400 naming the valid ones",
		body: { gameNames: ["Hades"], preset: "nope" },
		expectStatus: 400,
		expectBody: {
			success: false,
			data: expect.stringContaining("preset must be one of: default, bundle-research"),
		},
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "empty body returns 400 prefixed with 'Invalid file content:'",
		body: {},
		expectStatus: 400,
		expectBody: {
			success: false,
			// O prefixo está no nome do caso; verificá-lo é o mínimo.
			data: expect.stringContaining("Invalid file content:"),
		},
	},

	// -------------------------------------------------- POST /api/lists/run
	{
		route: "/api/lists/run",
		method: "post",
		name: "valid steam_id returns 202 queued",
		body: { steam_id: "76561198000000000" },
		expectStatus: 202,
		expectBody: { success: true, status: "queued" },
	},
	{
		route: "/api/lists/run",
		method: "post",
		name: "empty steam_id returns 400 with the message in `data`",
		body: { steam_id: "" },
		expectStatus: 400,
		// A mensagem é em português porque o controller responde assim hoje —
		// é o contrato em produção, não uma escolha desta bateria. Trocar o
		// idioma é mudança de contrato e precisa de PR próprio.
		expectBody: {
			success: false,
			data: "Erro no corpo da requisição: steam_id is required",
		},
	},
	{
		route: "/api/lists/run",
		method: "post",
		name: "empty body returns 400",
		body: {},
		expectStatus: 400,
		expectBody: {
			success: false,
			data: expect.stringContaining("Erro no corpo da requisição:"),
		},
	},

	// --------------------------------------------- POST /api/suppliers/find-new
	{
		route: "/api/suppliers/find-new",
		method: "post",
		name: "returns 202 queued and ignores the request body",
		body: {},
		expectStatus: 202,
		expectBody: { success: true, status: "queued" },
	},

	// ---------------------------------------------------------------- 500
	// Os três formatos de erro interno que existem hoje. Congelados aqui porque
	// o filter global do Nest tem um formato só: um controller que perdesse o seu
	// filter próprio mudaria o 500 sem nenhum outro teste perceber.
	{
		route: "/api/games/search-id-steam",
		method: "post",
		name: "internal failure returns 500 with `message`, not `details`",
		body: { games: [{ id: 1, name: CONTRACT_BOOM }] },
		expectStatus: 500,
		expectBody: {
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		},
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "internal failure returns 500 with `details` and a trailing period",
		body: { ...VALID_RESEARCH_BODY, gameNames: [CONTRACT_BOOM] },
		expectStatus: 500,
		// Note o ponto final em "error" — as rotas de search não o têm.
		expectBody: { success: false, error: "Internal server error." },
	},
	// A ORDEM da validação é observável: a mensagem nomeia a primeira variável
	// que faltou. Travar só a primeira deixaria as outras duas livres para
	// divergir entre os apps.
	{
		route: "/api/suppliers/find-new",
		method: "post",
		name: "missing configuration returns 500 with NO success field",
		env: { STEAMTRADES_SESSION: undefined },
		expectStatus: 500,
		expectBody: { error: "STEAMTRADES_SESSION is not defined in .env" },
	},
	{
		route: "/api/suppliers/find-new",
		method: "post",
		name: "names SISTEMA_ESTOQUE_URL when only that one is missing",
		env: { SISTEMA_ESTOQUE_URL: undefined },
		expectStatus: 500,
		expectBody: { error: "SISTEMA_ESTOQUE_URL is not defined in .env" },
	},
	{
		route: "/api/suppliers/find-new",
		method: "post",
		name: "names EXTERNAL_SECRET when only that one is missing",
		env: { EXTERNAL_SECRET: undefined },
		expectStatus: 500,
		expectBody: { error: "EXTERNAL_SECRET is not defined in .env" },
	},

	// ------------------------------------------------------------- 404 padrão
	{
		route: "/api/does-not-exist",
		method: "post",
		// Só o status faz parte do contrato. O corpo é o JSON padrão do Nest, e
		// nenhum cliente depende dele.
		name: "unknown route returns 404",
		body: {},
		expectStatus: 404,
	},
];

/** Todas as rotas cobertas — era o critério de conclusão do cutover. */
export const CONTRACT_ROUTES = [...new Set(CONTRACT_CASES.map((c) => c.route))];
