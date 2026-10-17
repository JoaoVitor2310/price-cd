import * as z from "zod";
import { SEARCH_PRESET_NAMES } from "@/domain/games/search-presets.js";

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

const gameNamesSchema = z
	.array(
		z
			.string()
			.trim()
			.min(1, { message: "Game name cannot be empty" }),
	)
	.min(1, { message: "At least one game name is required" });

const nonNegative = (field: string) =>
	z.number().min(0, { message: `${field} must be 0 or greater` });

/** Cada campo é opcional: o que faltar vem do preset. */
const popularityTiersSchema = z.strictObject({
	upToThreshold: nonNegative("popularity.upToThreshold").optional(),
	aboveThreshold: nonNegative("popularity.aboveThreshold").optional(),
	priceThresholdEuro: nonNegative("popularity.priceThresholdEuro").optional(),
});

/**
 * Corpo de `POST /api/games/research`.
 *
 * Os critérios saem de um preset (`default` se nenhum for enviado) e cada campo
 * enviado explicitamente sobrescreve o do preset — ver `docs/SEARCH_PRESETS.md`.
 * Converter um arquivo `.txt` em `gameNames` é responsabilidade de quem chama, não
 * do contrato da API.
 *
 * `minPopularity` é um atalho **temporário** para os dois tiers iguais: o Sistema
 * Estoque ainda o envia. Sai quando ele migrar para os presets (etapa 3 do plano).
 * Mandar `minPopularity` e `popularity` juntos é ambíguo e vira 400.
 */
export const researchGamesBodySchema = z
	.strictObject({
		gameNames: gameNamesSchema,
		preset: z
			.enum(SEARCH_PRESET_NAMES, {
				message: `preset must be one of: ${SEARCH_PRESET_NAMES.join(", ")}`,
			})
			.optional(),
		popularity: popularityTiersSchema.optional(),
		minPopularity: nonNegative("Minimum popularity").optional(),
		checkGamivoOffer: z.boolean().optional(),
		minPrice: nonNegative("minPrice").optional(),
		// Só vale com token. Sem token a resposta é sempre o demo síncrono.
		delivery: z
			.enum(["trade", "respond"], {
				message: "delivery must be one of: trade, respond",
			})
			.optional(),
		steam_id: z.string().optional(),
		list_code: z.string().optional(),
		internal_secret: z.string().optional(),
		title: z.string().optional(),
	})
	.refine((body) => body.minPopularity === undefined || body.popularity === undefined, {
		message: "Send either minPopularity or popularity, not both",
	});

export type ResearchGamesBody = z.infer<typeof researchGamesBodySchema>;
