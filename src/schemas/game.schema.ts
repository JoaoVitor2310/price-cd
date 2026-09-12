import * as z from "zod";

export const gameSearchSchema = z.strictObject({
	minPopularity: z
		.number()
		.min(0, { message: "Minimum popularity must be 0 or greater" }),
	gameNames: z
		.array(
			z
				.string()
				.trim()
				.min(1, { message: "Game name cannot be empty" }),
		)
		.min(1, { message: "At least one game name is required" }),
	checkGamivoOffer: z.boolean(),
});

export const gameIdSteamSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Game name is required" }),
});

export const gameIdSteamResponseSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Game name is required" }),
	id_steam: z.string().optional(),
});

export const steamIdLookupSchema = z.strictObject({
	games: z
		.array(gameIdSteamSchema)
		.min(1, { message: "At least one game is required" }),
});

export const steamIdLookupResponseSchema = z.strictObject({
	games: z
		.array(gameIdSteamResponseSchema)
		.min(1, { message: "At least one game is required" }),
});

export type GameSearch = z.infer<typeof gameSearchSchema>;
export type GameIdSteam = z.infer<typeof gameIdSteamSchema>;
export type GameIdSteamResponse = z.infer<typeof gameIdSteamResponseSchema>;
export type SteamIdLookup = z.infer<typeof steamIdLookupSchema>;
export type SteamIdLookupResponse = z.infer<typeof steamIdLookupResponseSchema>;

// A pesquisa recebe o mesmo formato estruturado da busca (`gameSearchSchema`) —
// `minPopularity` e `gameNames` são campos de primeira classe, não um blob de
// texto. Converter um arquivo `.txt` em `{ minPopularity, gameNames }` é
// responsabilidade de quem chama (front-end / adaptador de arquivo), não do
// contrato da API. `checkGamivoOffer` é opcional aqui (default `false`) porque a
// pesquisa é acionada por integrações que nem sempre se importam com a Gamivo.
export const researchGamesBodySchema = gameSearchSchema.extend({
	checkGamivoOffer: z.boolean().optional().default(false),
	// Piso de preço negociável. Omitido → default do domínio (€0,50). Bundles
	// mandam `0` para aceitar jogos abaixo do piso. Sem default aqui de propósito:
	// o domínio é a fonte única do valor padrão.
	minPrice: z
		.number()
		.min(0, { message: "minPrice must be 0 or greater" })
		.optional(),
	steam_id: z.string().optional(),
	list_code: z.string().optional(),
	internal_secret: z.string().optional(),
	title: z.string().optional(),
});

export type ResearchGamesBody = z.infer<typeof researchGamesBodySchema>;
