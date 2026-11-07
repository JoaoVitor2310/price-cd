import { type ArgumentsHost, Catch } from "@nestjs/common";
import { InvalidResearchRequestError } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/**
 * Os erros de `POST /api/games/research/from-topic`.
 *
 * A rota nasceu sem legado: responde no formato do filter global, sem o prefixo
 * `Invalid file content` de `research`. Declarado no método porque o
 * `GamesLegacyErrorFilter` do controller trocaria o formato do 500.
 *
 * A recusa da Application sai igual ao 400 de validação: para quem chama, as duas
 * são "corrija o pedido".
 */
@Catch()
export class TopicResearchErrorFilter extends AllExceptionsFilter {
	override catch(exception: unknown, host: ArgumentsHost): void {
		if (exception instanceof InvalidResearchRequestError) {
			this.respondValidationFailed(exception.message, host);
			return;
		}
		super.catch(exception, host);
	}
}
