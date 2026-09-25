import { Catch } from "@nestjs/common";
import { LegacyDataErrorFilter } from "@/nest/common/legacy-data-error.filter.js";

/**
 * O formato de erro legado de `POST /api/games/research`.
 *
 * O prefixo é herança de quando o endpoint recebia um arquivo `.txt` — hoje ele
 * recebe JSON estruturado, e a mensagem continua falando de "file content".
 */
@Catch()
export class ResearchLegacyErrorFilter extends LegacyDataErrorFilter {
	protected readonly messagePrefix = "Invalid file content";
}
