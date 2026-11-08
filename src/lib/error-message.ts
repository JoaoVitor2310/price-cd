/** A mensagem de um erro para uma linha de log; `String` para o que não é `Error`. */
export const errorMessage = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);
