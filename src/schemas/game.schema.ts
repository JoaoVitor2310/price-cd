import * as z from "zod";

export const fileUploadSchema = z.object({
	file: z.object({
		path: z.string().min(1, "Caminho do arquivo é obrigatório"),
		filename: z.string().min(1, "Nome do arquivo é obrigatório"),
		mimetype: z.string().min(1, "Tipo do arquivo é obrigatório"),
		size: z.number().min(1, "Arquivo não pode estar vazio"),
	}).refine((file) => {
		const allowedTypes = ['text/plain'];
		return allowedTypes.includes(file.mimetype);
	}, {
		message: "Tipo de arquivo não suportado. Use .txt"
	})
});

export const gameSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Nome do jogo é obrigatório" }),
	popularity: z
		.number()
		.min(0, { message: "Popularidade deve ser maior ou igual a 0" }),
	id_steam: z.string().optional(),
	region: z.string().optional(),
	GamivoPrice: z.string().optional(),
});

export const fileContentSchema = z.strictObject({
	minPopularity: z
		.number()
		.min(0, { message: "Popularidade mínima deve ser maior ou igual a 0" }),
	gameNames: z
		.array(
			z
				.string()
				.trim()
				.min(1, { message: "Nome do jogo não pode estar vazio" }),
		)
		.min(1, { message: "Pelo menos um nome de jogo é necessário" }),
	checkGamivoOffer: z.boolean(),
});

export const gameIdSteamSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Nome do jogo é obrigatório" }),
});

export const gameIdSteamResponseSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { message: "Nome do jogo é obrigatório" }),
	id_steam: z.string().optional(),
});

export const fileContentIdSteamSchema = z.strictObject({
	games: z
		.array(gameIdSteamSchema)
		.min(1, { message: "Pelo menos um jogo do sistema é necessário" }),
});

export const fileContentIdSteamResponseSchema = z.strictObject({
	games: z
		.array(gameIdSteamResponseSchema)
		.min(1, { message: "Pelo menos um jogo do sistema é necessário" }),
});

export type FileUpload = z.infer<typeof fileUploadSchema>;
export type Game = z.infer<typeof gameSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;
export type GameIdSteam = z.infer<typeof gameIdSteamSchema>;
export type GameIdSteamResponse = z.infer<typeof gameIdSteamResponseSchema>;
export type FileContentIdSteam = z.infer<typeof fileContentIdSteamSchema>;
export type FileContentIdSteamResponse = z.infer<typeof fileContentIdSteamResponseSchema>;

export const validateFileUpload = (req: { file?: Express.Multer.File }): FileUpload => {
	if (!req.file) {
		throw new Error("Nenhum arquivo foi enviado")
	}

	const result = fileUploadSchema.parse({ file: req.file });

	return result;
}

const fileLineSchema = z.string().transform((val) => val.trim());

export const validateFileContent = (content: string, checkGamivoOffer: string | boolean): FileContent => {
	const lines = content.split("\n");

	if (lines.length < 2) {
		throw new Error(
			"O arquivo deve conter pelo menos 2 linhas: popularidade mínima e pelo menos um nome de jogo",
		);
	}

	const minPopularityStr = fileLineSchema.parse(lines[0]);
	const minPopularity = z.coerce
		.number()
		.min(0, { message: "Popularidade mínima deve ser maior ou igual a 0" })
		.parse(minPopularityStr);

	const gameNames = lines
		.slice(1)
		.map((line) => fileLineSchema.parse(line))
		.filter((line) => line !== "");

	// Convert string "true"/"false" to boolean
	const checkGamivoOfferBoolean = typeof checkGamivoOffer === 'string'
		? checkGamivoOffer === 'true'
		: checkGamivoOffer;

	return fileContentSchema.parse({
		minPopularity,
		gameNames,
		checkGamivoOffer: checkGamivoOfferBoolean,
	});
}