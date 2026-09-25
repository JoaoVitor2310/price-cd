import { type ArgumentsHost, Catch, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { ZodError } from "zod";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * O formato de erro legado de `POST /api/games/research`.
 *
 * Aqui o que diverge é o **400**: a mensagem vai no campo `data` — o mesmo campo
 * que em toda resposta de sucesso carrega o resultado — prefixada por
 * `"Invalid file content:"`, herança de quando o endpoint recebia um `.txt`.
 * O 500 é igual ao global, então não é sobrescrito.
 *
 * Feio de propósito: uniformizar isto durante a migração destruiria o único
 * instrumento que distingue "o Nest quebrou" de "eu mudei" (`docs/NEST.md` §4).
 * Some no item 17 do `docs/IMPROVEMENTS.md`, depois que o Express sair.
 */
@Catch()
export class ResearchLegacyErrorFilter extends AllExceptionsFilter {
	private readonly researchLogger = new Logger(ResearchLegacyErrorFilter.name);

	protected override handleZodError(exception: ZodError, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<Response>();
		// Só a mensagem, sem o caminho do campo — diferente do filter global,
		// que prefixa cada problema com `path`.
		const message = exception.issues.map((issue) => issue.message).join(", ");

		this.researchLogger.warn(`Invalid file content: ${message}`);
		response.status(400).json({
			success: false,
			data: `Invalid file content: ${message}`,
		});
	}
}
