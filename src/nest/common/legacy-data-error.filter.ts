import { type ArgumentsHost, Catch, Logger } from "@nestjs/common";
import type { Response } from "express";
import type { ZodError } from "zod";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * Base para as rotas cujo 400 devolve a mensagem no campo **`data`**.
 *
 * Duas rotas respondem assim hoje — `/api/games/research` e `/api/lists/run` —
 * usando `data`, o mesmo campo que numa resposta de sucesso carrega o
 * resultado. Só o prefixo da mensagem difere entre elas.
 *
 * Congelar o **formato** durante a migração é obrigatório (`docs/NEST.md` §4);
 * copiar o **código** não é. As subclasses declaram só o prefixo.
 *
 * Toda esta hierarquia some no item 17 do `docs/IMPROVEMENTS.md`, quando os
 * formatos forem uniformizados — o que só pode acontecer depois que o Express
 * sair de cena.
 */
@Catch()
export abstract class LegacyDataErrorFilter extends AllExceptionsFilter {
	/** Ex.: `"Invalid file content"`, `"Erro no corpo da requisição"`. */
	protected abstract readonly messagePrefix: string;

	protected override handleZodError(exception: ZodError, host: ArgumentsHost): void {
		const response = host.switchToHttp().getResponse<Response>();
		// Só a mensagem, sem o caminho do campo — diferente do filter global,
		// que prefixa cada problema com `path`.
		const message = exception.issues.map((issue) => issue.message).join(", ");
		const body = `${this.messagePrefix}: ${message}`;

		new Logger(this.constructor.name).warn(body);
		response.status(400).json({ success: false, data: body });
	}
}
