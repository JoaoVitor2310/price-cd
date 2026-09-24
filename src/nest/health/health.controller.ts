import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/env.schema.js";

/**
 * Prova que o app Nest sobe e que o `ConfigService` está resolvendo.
 *
 * Existe por duas razões, além do óbvio: é o primeiro teste de que a cadeia de
 * DI funciona (injeção por tipo depende de `design:paramtypes` — ver ADR 0004),
 * e dá ao Docker um alvo de healthcheck quando o cutover chegar no PR 9.
 */
@Controller("health")
export class HealthController {
	constructor(private readonly config: ConfigService<Env, true>) {}

	@Get()
	check() {
		return {
			status: "ok",
			app: "nest",
			env: this.config.get("NODE_ENV", { infer: true }),
		};
	}
}
