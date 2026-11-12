import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "@/config/env.schema.js";
import {
	QueueDashboard,
	queueDashboardSettings,
} from "@/nest/queue-dashboard/queue-dashboard.js";

/**
 * O painel das filas (ADR 0011). Provider porque tem ciclo de vida — fecha a
 * conexão de leitura no desligamento —, montado no Express pelo
 * `configureNestApp`, que é o que `main.ts` e os testes compartilham.
 */
@Module({
	providers: [
		{
			provide: QueueDashboard,
			useFactory: (config: ConfigService<Env, true>) =>
				new QueueDashboard(
					queueDashboardSettings({
						QUEUE_REDIS_URL: config.get("QUEUE_REDIS_URL", { infer: true }),
						QUEUE_DASHBOARD_USER: config.get("QUEUE_DASHBOARD_USER", {
							infer: true,
						}),
						QUEUE_DASHBOARD_PASSWORD: config.get("QUEUE_DASHBOARD_PASSWORD", {
							infer: true,
						}),
					}),
				),
			inject: [ConfigService],
		},
	],
	exports: [QueueDashboard],
})
export class QueueDashboardModule {}
