import { type ArgumentsHost, Catch } from "@nestjs/common";
import { InvalidResearchRequestError } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import { LegacyDataErrorFilter } from "@/nest/common/legacy-data-error.filter.js";

/**
 * O formato de erro legado de `POST /api/games/research`.
 *
 * O prefixo é herança de quando o endpoint recebia um arquivo `.txt` — hoje ele
 * recebe JSON estruturado, e a mensagem continua falando de "file content".
 *
 * `InvalidResearchRequestError` (a Application recusando um pedido válido na
 * forma, como um webhook para host não permitido) sai como o 400 de validação
 * desta rota: para quem chama, as duas coisas são "corrija o pedido".
 */
@Catch()
export class ResearchLegacyErrorFilter extends LegacyDataErrorFilter {
	protected readonly messagePrefix = "Invalid file content";

	override catch(exception: unknown, host: ArgumentsHost): void {
		if (exception instanceof InvalidResearchRequestError) {
			this.respondBadRequest(exception.message, host);
			return;
		}
		super.catch(exception, host);
	}
}
