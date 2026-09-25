import { type ArgumentsHost, Catch, Logger } from "@nestjs/common";
import type { Response } from "express";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * O formato de erro legado das rotas de busca (`/api/games/search`,
 * `/search-id-steam`).
 *
 * Existe porque o contrato atual **não é uniforme** e a migração é proibida de
 * uniformizá-lo (`docs/NEST.md` §4): enquanto Express e Nest coexistem, qualquer
 * diferença de resposta precisa significar "o Nest quebrou", nunca "eu melhorei".
 *
 * Só o **500** destas rotas diverge do global — elas usam `message` e um
 * "Internal server error" **sem** ponto final, enquanto o global usa `details` e
 * **com** ponto. Por isso herda em vez de copiar: 400 e `HttpException`
 * continuam sendo os do pai, inclusive o log de validação.
 *
 * Some no PR de uniformização (item 16 do `docs/IMPROVEMENTS.md`), que só pode
 * acontecer depois que o Express sair.
 */
@Catch()
export class GamesLegacyErrorFilter extends AllExceptionsFilter {
	protected override handleUnknown(exception: unknown, host: ArgumentsHost): void {
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
