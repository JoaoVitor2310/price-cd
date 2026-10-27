import { type ArgumentsHost, Catch, Logger } from "@nestjs/common";
import type { Response } from "express";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * O formato de erro legado de `/api/games/search-id-steam` — a última rota que
 * sobrou do grupo de busca depois que `/api/games/search` saiu.
 *
 * Existe porque o contrato atual **não é uniforme**, e uniformizar é o item 15 do
 * `docs/IMPROVEMENTS.md` — um PR de contrato, deliberado, não um efeito colateral.
 *
 * Só o **500** desta rota diverge do global — ela usa `message` e um
 * "Internal server error" **sem** ponto final, enquanto o global usa `details` e
 * **com** ponto. Por isso herda em vez de copiar: 400 e `HttpException`
 * continuam sendo os do pai, inclusive o log de validação.
 *
 * Some no PR de uniformização (item 15 do `docs/IMPROVEMENTS.md`).
 */
@Catch()
export class GamesLegacyErrorFilter extends AllExceptionsFilter {
	protected override handleUnknown(
		exception: unknown,
		host: ArgumentsHost,
	): void {
		const response = host.switchToHttp().getResponse<Response>();

		// `this.constructor.name` em vez de um logger por subclasse: o pai fixa
		// `AllExceptionsFilter.name`, e cada filho redeclarar o seu era o que
		// gerava a repetição.
		new Logger(this.constructor.name).error(
			`Game search failed: ${exception instanceof Error ? exception.message : exception}`,
			(exception as Error)?.stack,
		);

		response.status(500).json({
			success: false,
			error: "Internal server error",
			message: "Failed to analyze games",
		});
	}
}
