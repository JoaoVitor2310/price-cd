import { Catch } from "@nestjs/common";
import { LegacyDataErrorFilter } from "@/nest/common/legacy-data-error.filter.js";

/**
 * O formato de erro legado de `POST /api/lists/run`.
 *
 * Único caso do projeto em que a mensagem é **em português** — todas as outras
 * rotas respondem em inglês. É o contrato em produção, não escolha: ver
 * `CLAUDE.md`, "Idioma no código".
 */
@Catch()
export class ListsLegacyErrorFilter extends LegacyDataErrorFilter {
	protected readonly messagePrefix = "Erro no corpo da requisição";
}
