import { type ArgumentsHost, Catch, Logger } from "@nestjs/common";
import type { Response } from "express";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * O formato de erro legado de `POST /api/suppliers/find-new`.
 *
 * É o mais destoante do projeto: o 500 responde `{ error: <mensagem> }` — **sem
 * o campo `success`**, que todas as outras rotas têm, e com a mensagem crua em
 * vez de um texto genérico.
 *
 * Congelado de propósito durante a migração. Some no item 14 do
 * `docs/IMPROVEMENTS.md`, agora desbloqueado.
 */
@Catch()
export class SuppliersLegacyErrorFilter extends AllExceptionsFilter {
	protected override handleUnknown(
		exception: unknown,
		host: ArgumentsHost,
	): void {
		const response = host.switchToHttp().getResponse<Response>();
		const message =
			exception instanceof Error ? exception.message : "Unknown error";

		new Logger(this.constructor.name).error(
			`Error queuing suppliers search: ${message}`,
		);
		response.status(500).json({ error: message });
	}
}
