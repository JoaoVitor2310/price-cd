import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
// Import de VALOR: a classe abstrata é o token de injeção (ADR 0004).
import { PriceCache } from "@/application/games/ports/price-cache.port.js";
import type { Env } from "@/config/env.schema.js";

/**
 * Prova que o app Nest sobe e que o `ConfigService` está resolvendo.
 *
 * Existe por duas razões, além do óbvio: é o primeiro teste de que a cadeia de
 * DI funciona (injeção por tipo depende de `design:paramtypes` — ver ADR 0004),
 * e dá ao Docker um alvo de healthcheck.
 *
 * `cache` é o estado do cache de preço (ADR 0008): `up`, `down` (Redis
 * configurado e fora do ar) ou `disabled` (sem `REDIS_URL`). A resposta continua
 * `200` com o cache fora: liveness não depende de dependência opcional, senão um
 * healthcheck reiniciaria o app por causa do Redis. Quem quer ser avisado da
 * queda olha o campo — é o alvo do monitor externo (`docs/IMPROVEMENTS.md`).
 */
@Controller("health")
export class HealthController {
	constructor(
		private readonly config: ConfigService<Env, true>,
		private readonly priceCache: PriceCache,
	) {}

	@Get()
	async check() {
		return {
			status: "ok",
			app: "nest",
			env: this.config.get("NODE_ENV", { infer: true }),
			cache: await this.priceCache.status(),
		};
	}
}
