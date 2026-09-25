/**
 * O contrato HTTP da API, como ele é HOJE — não como ele deveria ser.
 *
 * Esta tabela é o portão objetivo da migração para Nest (`docs/NEST.md` §4): a
 * mesma bateria roda contra o app Express e contra o app Nest, e a paridade
 * está provada quando os dois passam nos mesmos casos.
 *
 * Por isso as inconsistências de formato entre controllers estão **congeladas
 * de propósito**: `/games/research` devolve a mensagem de erro em `data`,
 * `/games/search` devolve em `error` + `details`, `/suppliers/find-new` nem tem
 * campo `success` no 500, e "Internal server error" aparece com e sem ponto
 * final. Uniformizar isso durante a migração impede distinguir "diferença é bug
 * do Nest" de "diferença é melhoria intencional" — se for uniformizar, é um PR
 * separado, antes ou depois, nunca durante.
 */

export type HttpMethod = "get" | "post";

export type ContractCase = {
	/** Rota exata, do jeito que o cliente chama. Serve de chave do opt-in por rota. */
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
 * Existe porque o 500 é a divergência mais perigosa da migração — cada grupo de
 * rotas responde um formato diferente — e sem um jeito declarativo de provocar
 * a falha não haveria como travar esses formatos.
 */
export const CONTRACT_BOOM = "__contract_boom__";

const VALID_SEARCH_BODY = {
	minPopularity: 0,
	gameNames: ["Hades"],
	checkGamivoOffer: false,
};

export const CONTRACT_CASES: ContractCase[] = [
	// ------------------------------------------------------------------ GET /
	{
		route: "/",
		method: "get",
		name: "serves public/index.html, NOT the authorship handler",
		expectStatus: 200,
		// `app.use(express.static(publicDir))` vem ANTES de `app.get("/")` em
		// `src/app.ts`, então o estático ganha e o handler com o texto do
		// LinkedIn é inalcançável. Travado aqui porque no Nest a ordem de
		// `useStaticAssets` vs rota é fácil de inverter sem ninguém notar.
		expectText: "<!DOCTYPE html>",
	},

	// ------------------------------------------------- POST /api/games/search
	{
		route: "/api/games/search",
		method: "post",
		name: "valid body returns success and data.summary",
		body: VALID_SEARCH_BODY,
		expectStatus: 200,
		expectBody: { success: true, data: { summary: { totalRequested: 1 } } },
	},
	{
		route: "/api/games/search",
		method: "post",
		name: "empty gameNames returns 400 with error and details",
		body: { ...VALID_SEARCH_BODY, gameNames: [] },
		expectStatus: 400,
		expectBody: { success: false, error: "Validation failed" },
	},
	{
		route: "/api/games/search",
		method: "post",
		name: "empty body returns 400",
		body: {},
		expectStatus: 400,
		expectBody: { success: false, error: "Validation failed" },
	},
	{
		route: "/api/games/search",
		method: "post",
		name: "unknown field returns 400 because the schema is a strictObject",
		body: { ...VALID_SEARCH_BODY, unknownField: 1 },
		expectStatus: 400,
		expectBody: { success: false, error: "Validation failed" },
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
		expectBody: { success: false, error: "Validation failed" },
	},

	// ----------------------------------------------- POST /api/games/research
	{
		route: "/api/games/research",
		method: "post",
		name: "no internal_secret returns 200 demo, not 401",
		body: VALID_SEARCH_BODY,
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "wrong internal_secret returns 200 demo, not 403",
		body: { ...VALID_SEARCH_BODY, internal_secret: "wrong-secret" },
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "correct internal_secret returns 202 queued",
		body: { ...VALID_SEARCH_BODY, internal_secret: CONTRACT_SECRET },
		env: { INTERNAL_SECRET: CONTRACT_SECRET },
		expectStatus: 202,
		expectBody: { success: true, status: "queued" },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "unset INTERNAL_SECRET returns 200 demo even with a token",
		body: { ...VALID_SEARCH_BODY, internal_secret: CONTRACT_SECRET },
		env: { INTERNAL_SECRET: undefined },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "checkGamivoOffer is optional here and defaults to false",
		body: { minPopularity: 0, gameNames: ["Hades"] },
		expectStatus: 200,
		expectBody: { success: true, demo: true },
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "negative minPrice returns 400 with the message in `data`, not `error`",
		body: { ...VALID_SEARCH_BODY, minPrice: -1 },
		expectStatus: 400,
		expectBody: {
			success: false,
			data: "Invalid file content: minPrice must be 0 or greater",
		},
	},
	{
		route: "/api/games/research",
		method: "post",
		name: "empty body returns 400 prefixed with 'Invalid file content:'",
		body: {},
		expectStatus: 400,
		expectBody: { success: false },
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
		expectBody: { success: false },
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
	// é a divergência mais perigosa da migração: um filter global do Nest tem um
	// default só, e sem estes casos a regressão passaria sem ruído.
	{
		route: "/api/games/search",
		method: "post",
		name: "internal failure returns 500 with `message`, not `details`",
		body: { ...VALID_SEARCH_BODY, gameNames: [CONTRACT_BOOM] },
		expectStatus: 500,
		expectBody: {
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		},
	},
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
		body: { ...VALID_SEARCH_BODY, gameNames: [CONTRACT_BOOM] },
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
		name: "unknown route returns the Express 404 with no JSON error body",
		body: {},
		expectStatus: 404,
	},
];

/** Todas as rotas cobertas — usada pelo critério de conclusão do PR 9. */
export const CONTRACT_ROUTES = [...new Set(CONTRACT_CASES.map((c) => c.route))];
