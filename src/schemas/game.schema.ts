import * as z from "zod";

export const gameSchema = z.strictObject({
	id: z.number(),
	name: z.string().min(1, { error: "Nome do jogo é obrigatório" }),
	popularity: z
		.number()
		.min(0, { error: "Popularidade deve ser maior ou igual a 0" }),
	GamivoPrice: z.string().optional(),
});

export const fileContentSchema = z.strictObject({
	minPopularity: z
		.number()
		.min(0, { error: "Popularidade mínima deve ser maior ou igual a 0" }),
	gameNames: z
		.array(
			z.string().trim().min(1, { error: "Nome do jogo não pode estar vazio" }),
		)
		.min(1, { error: "Pelo menos um nome de jogo é necessário" }),
});

export type Game = z.infer<typeof gameSchema>;
export type FileContent = z.infer<typeof fileContentSchema>;

const fileLineSchema = z.string().transform((val) => val.trim());

export function validateFileContent(content: string): FileContent {
	const lines = content.split("\n");

	if (lines.length < 2) {
		throw new Error(
			"O arquivo deve conter pelo menos 2 linhas: popularidade mínima e pelo menos um nome de jogo",
		);
	}

	const minPopularityStr = fileLineSchema.parse(lines[0]);
	const minPopularity = z.coerce
		.number()
		.min(0, { error: "Popularidade mínima deve ser maior ou igual a 0" })
		.parse(minPopularityStr);

	const gameNames = lines
		.slice(1)
		.map((line) => fileLineSchema.parse(line))
		.filter((line) => line !== "");

	return fileContentSchema.parse({
		minPopularity,
		gameNames,
	});
}

export function validateFoundGames(games: unknown): Game[] {
	return z
		.array(gameSchema)
		.min(1, { error: "Nenhum jogo encontrado" })
		.parse(games);
}
