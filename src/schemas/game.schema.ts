import * as z from "zod";

export const gameSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Game name is required" }),
	popularity: z
		.number()
		.min(0, { message: "Popularity must be 0 or greater" }),
	id_steam: z.string().optional(),
	region: z.string().optional(),
	GamivoPrice: z.string().optional(),
});

export const fileContentSchema = z.strictObject({
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

export const fileContentIdSteamSchema = z.strictObject({
	games: z
		.array(gameIdSteamSchema)
		.min(1, { message: "At least one game is required" }),
});

export const fileContentIdSteamResponseSchema = z.strictObject({
	games: z
		.array(gameIdSteamResponseSchema)
		.min(1, { message: "At least one game is required" }),
});

export type Game = z.infer<typeof gameSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type GameIdSteam = z.infer<typeof gameIdSteamSchema>;
export type GameIdSteamResponse = z.infer<typeof gameIdSteamResponseSchema>;
export type FileContentIdSteam = z.infer<typeof fileContentIdSteamSchema>;
export type FileContentIdSteamResponse = z.infer<typeof fileContentIdSteamResponseSchema>;

const fileLineSchema = z.string().transform((val) => val.trim());

const parseGameListContent = (content: string, checkGamivoOffer: boolean): FileContent => {
	const lines = content.split("\n");

	const minPopularityStr = fileLineSchema.parse(lines[0] ?? "");
	const minPopularity = z.coerce
		.number()
		.min(0, { message: "Minimum popularity must be 0 or greater" })
		.parse(minPopularityStr);

	const gameNames = lines
		.slice(1)
		.map((line) => fileLineSchema.parse(line))
		.filter((line) => line !== "");

	return fileContentSchema.parse({ minPopularity, gameNames, checkGamivoOffer });
};

export const researchGamesBodySchema = z
	.object({
		content: z.string().min(1, { message: "The 'content' field is required." }),
		checkGamivoOffer: z.boolean().optional().default(false),
		steam_id: z.string().optional(),
		list_code: z.string().optional(),
	})
	.transform((val) => ({
		...parseGameListContent(val.content, val.checkGamivoOffer),
		steam_id: val.steam_id,
		list_code: val.list_code,
	}));

export type ResearchGamesBody = z.infer<typeof researchGamesBodySchema>;
