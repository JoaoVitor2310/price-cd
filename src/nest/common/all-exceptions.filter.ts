import {
	type ArgumentsHost,
	Catch,
	type ExceptionFilter,
	HttpException,
	Logger,
} from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";

/**
 * O único lugar que transforma exceção em resposta HTTP.
 *
 * Substitui o `try/catch` triplicado dos controllers Express, que hoje repetem
 * a mesma árvore (`ZodError` → 400, `Error` → 500, resto → 500) com pequenas
 * divergências de formato entre si.
 *
 * ## As divergências que este filter NÃO resolve sozinho
 *
 * O contrato atual não é uniforme (ver `test/contract/contract-cases.ts`), e a
 * divergência vale tanto para 400 quanto para 500:
 *
 * | Rota | 400 | 500 |
 * |---|---|---|
 * | `/api/games/search`, `/api/games/search-id-steam` | `error` + `details` | `error` **sem ponto** + `message: "Failed to analyze games"` |
 * | `/api/games/research`, `/api/lists/run` | mensagem em `data` | `error` **com ponto** + `details` |
 * | `/api/suppliers/find-new` | — | só `{ error }`, **sem `success`** |
 *
 * Um filter global tem um default só. O default daqui é o 400 de `search` e o
 * 500 de `research` — ou seja, **nenhum grupo de rotas é atendido inteiro**: as
 * duas rotas que o PR 3 migra batem no 400 e divergem no 500.
 *
 * Por isso cada controller que diverge precisa declarar seu formato legado com
 * `@UseFilters(...)` no PR em que for migrado (3 a 5). Não foi construído aqui
 * porque ainda não existe controller nenhum — seria abstração para necessidade
 * inexistente. O que existe é o portão: a bateria de contrato cobre os três
 * formatos de 500 e falha se alguém esquecer.
 *
 * Mudar qualquer um desses formatos é mudança de contrato, proibida durante a
 * migração (`docs/NEST.md` §4).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
	private readonly logger = new Logger(AllExceptionsFilter.name);

	catch(exception: unknown, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<Response>();

		if (exception instanceof ZodError) {
			const details = exception.issues
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join(", ");

			this.logger.warn(`Validation failed: ${details}`);
			response.status(400).json({
				success: false,
				error: "Validation failed",
				details,
			});
			return;
		}

		if (exception instanceof HttpException) {
			const status = exception.getStatus();
			const body = exception.getResponse();

			response
				.status(status)
				.json(typeof body === "string" ? { success: false, error: body } : body);
			return;
		}

		// Erro não previsto: 500 com a mensagem, como os controllers fazem hoje.
		// A stack vai para o log, nunca para a resposta.
		const message = exception instanceof Error ? exception.message : "Unknown error";
		this.logger.error(`Unhandled exception: ${message}`, (exception as Error)?.stack);

		response.status(500).json({
			success: false,
			error: "Internal server error.",
			details: message,
		});
	}
}
