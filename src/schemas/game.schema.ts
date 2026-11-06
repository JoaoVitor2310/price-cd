import * as z from "zod";
import { SEARCH_PRESET_NAMES } from "@/domain/games/search-presets.js";
import { OFFER_CURRENCIES } from "@/domain/suppliers/offer.js";

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
 * SteamID64 de conta individual: 17 dígitos começando por `7656119`. É a regra
 * do Sistema Estoque (`App\Domain\Suppliers\SteamId`) para criar a Trade com
 * oferta — conferida aqui para o erro sair como 400 na requisição, e não como
 * um `failed` minutos depois.
 */
const STEAM_ID64 = /^7656119\d{10}$/;

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
 *
 * `currency`, `request_uuid` e `webhook_url` são o pedido com aviso de resultado
 * (ADR 0010). As regras entre eles ficam no `superRefine` abaixo; as que dependem
 * do token ou da configuração (allowlist do webhook) ficam no controller e no use
 * case, que é onde esse contexto existe.
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
		// Se consulta o SteamCharts. Os tiers de `popularity` só cortam; um tier acima de
		// 0 liga a consulta de qualquer jeito (`resolveSearchCriteria`).
		lookupPopularity: z.boolean().optional(),
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
		// A Moeda de oferta. Presente, a Trade nasce com oferta (`POST /api/trades`
		// do Estoque) e exige `steam_id` SteamID64.
		currency: z
			.enum(OFFER_CURRENCIES, {
				message: `currency must be one of: ${OFFER_CURRENCIES.join(", ")}`,
			})
			.optional(),
		request_uuid: z.uuid({ message: "request_uuid must be a UUID" }).optional(),
		webhook_url: z
			.url({
				protocol: /^https?$/,
				message: "webhook_url must be an http(s) URL",
			})
			.optional(),
	})
	.superRefine((body, ctx) => {
		const issue = (path: string, message: string) =>
			ctx.addIssue({ code: "custom", path: [path], message });

		if (body.webhook_url !== undefined) {
			if (body.request_uuid === undefined)
				issue("request_uuid", "webhook_url requires request_uuid");
			// Só a Trade com oferta devolve o uuid que o webhook informa.
			if (body.currency === undefined)
				issue("currency", "webhook_url requires currency");
		}

		if (
			body.currency !== undefined &&
			(body.steam_id === undefined || !STEAM_ID64.test(body.steam_id))
		) {
			issue("steam_id", "currency requires steam_id as a SteamID64");
		}

		// `respond` devolve o resultado na própria resposta: não há Trade com
		// oferta a criar nem nada a avisar depois.
		if (
			body.delivery === "respond" &&
			(body.currency !== undefined ||
				body.request_uuid !== undefined ||
				body.webhook_url !== undefined)
		) {
			issue(
				"delivery",
				'delivery "respond" does not accept currency, request_uuid or webhook_url',
			);
		}
	});

export type ResearchGamesBody = z.infer<typeof researchGamesBodySchema>;
