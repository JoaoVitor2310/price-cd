import * as z from "zod";
import { SEARCH_PRESET_NAMES } from "@/domain/games/search-presets.js";

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
 * enviado explicitamente sobrescreve o do preset — ver `docs/adr/0007-presets-de-pesquisa-moram-no-price-cd.md`.
 * Converter um arquivo `.txt` em `gameNames` é responsabilidade de quem chama, não
 * do contrato da API.
 *
 * Não existe `minPopularity`: popularidade plana é o mesmo valor nos dois tiers de
 * `popularity`. O campo foi um atalho da migração para os presets e saiu quando o
 * Sistema Estoque migrou; mandá-lo hoje é campo desconhecido, logo 400.
 */
export const researchGamesBodySchema = z.strictObject({
	gameNames: gameNamesSchema,
	preset: z
		.enum(SEARCH_PRESET_NAMES, {
			message: `preset must be one of: ${SEARCH_PRESET_NAMES.join(", ")}`,
		})
		.optional(),
	popularity: popularityTiersSchema.optional(),
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
});

export type ResearchGamesBody = z.infer<typeof researchGamesBodySchema>;
