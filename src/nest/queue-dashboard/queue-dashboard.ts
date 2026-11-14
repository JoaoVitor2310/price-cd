import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { OnApplicationShutdown } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { BullmqConnectionLog } from "@/infrastructure/background/bullmq-connection-log.js";
import { createBullmqReaderConnection } from "@/infrastructure/background/bullmq-connections.js";
import { QUEUE_NAMES } from "@/infrastructure/background/queue-names.js";
import { basicAuth } from "@/nest/queue-dashboard/basic-auth.js";

/**
 * O painel das filas: o Bull Board sobre as quatro filas do banco 1. Ver
 * `docs/adr/0011-painel-das-filas.md`.
 *
 * Vive em `nest/` porque é apresentação — uma interface HTTP para quem opera o
 * price-cd. Não toca Domain nem Application, e não pega as filas dos adapters:
 * abre a própria conexão de leitura e um `Queue` da BullMQ por nome. Assim o
 * painel não se acopla a como cada fila é montada, e só existe quando ligado.
 *
 * **Somente leitura em todas** (`readOnlyMode`, conferido no servidor do Bull
 * Board: as rotas de escrita respondem 405). Repetir um job de Reabastecimento, ou
 * de pesquisa sem `request_uuid`, pelo painel criaria outra Trade — o mesmo
 * motivo de esses jobs terem uma tentativa só (ADR 0009).
 */

/** Sob o mesmo prefixo das rotas da API, para passar pelo mesmo proxy. */
export const QUEUE_DASHBOARD_PATH = "/api/admin/queues";

export type QueueDashboardSettings = {
	redisUrl: string;
	user: string;
	password: string;
};

/** O que cada fila faz, como o painel mostra embaixo do nome. */
const DESCRIPTIONS: Record<(typeof QUEUE_NAMES)[number], string> = {
	research:
		"Authenticated research: price, popularity and the Trade (ADR 0009)",
	webhooks:
		"Research result delivery to the caller, retried for ~24h (ADR 0010)",
	lists: "Supplier restock: the supplier's Lists, priced into a Trade",
	suppliers: "Supplier discovery: SteamTrades sweep and comments",
};

/**
 * Ligado só com as credenciais e a fila durável. Sem `QUEUE_REDIS_URL` as filas
 * são em memória e não há o que mostrar.
 */
export const queueDashboardSettings = (env: {
	QUEUE_REDIS_URL?: string;
	QUEUE_DASHBOARD_USER?: string;
	QUEUE_DASHBOARD_PASSWORD?: string;
}): QueueDashboardSettings | undefined => {
	const {
		QUEUE_REDIS_URL: redisUrl,
		QUEUE_DASHBOARD_USER: user,
		QUEUE_DASHBOARD_PASSWORD: password,
	} = env;
	if (!redisUrl || !user || !password) return undefined;
	return { redisUrl, user, password };
};

export class QueueDashboard implements OnApplicationShutdown {
	private opened: { connection: Redis; queues: Queue[] } | undefined;

	constructor(private readonly settings: QueueDashboardSettings | undefined) {}

	/**
	 * Monta o painel no Express de baixo do Nest. Chamado pelo `configureNestApp`,
	 * antes do `init`: é um router Express, não uma rota de controller, e por
	 * isso o prefixo global não se aplica — o caminho já é completo.
	 */
	mount(app: Pick<NestExpressApplication, "use">): void {
		if (!this.settings) {
			console.log(
				"🔒 [DASHBOARD] Queue dashboard off — it needs QUEUE_REDIS_URL, QUEUE_DASHBOARD_USER and QUEUE_DASHBOARD_PASSWORD.",
			);
			return;
		}
		const { redisUrl, user, password } = this.settings;

		const log = new BullmqConnectionLog({
			back: "📊 [DASHBOARD] Redis is responding again — queue dashboard back on.",
			down: (operation, reason) =>
				`⚠️ [DASHBOARD] Redis ${operation} failed (${reason}) — the queue dashboard shows errors until it responds.`,
		});
		const connection = createBullmqReaderConnection(redisUrl, {
			up: () => log.up(),
			down: (operation, error) => log.down(operation, error),
		});
		const queues = QUEUE_NAMES.map((name) => {
			const queue = new Queue(name, { connection });
			queue.on("error", (error) => log.down("queue", error));
			return queue;
		});
		this.opened = { connection, queues };

		const serverAdapter = new ExpressAdapter();
		serverAdapter.setBasePath(QUEUE_DASHBOARD_PATH);
		createBullBoard({
			queues: queues.map(
				(queue) =>
					new BullMQAdapter(queue, {
						readOnlyMode: true,
						description: DESCRIPTIONS[queue.name as keyof typeof DESCRIPTIONS],
					}),
			),
			serverAdapter,
			options: { uiConfig: { boardTitle: "price-cd queues" } },
		});

		app.use(
			QUEUE_DASHBOARD_PATH,
			basicAuth({ user, password, realm: "price-cd queues" }),
			serverAdapter.getRouter(),
		);
		console.log(
			`📊 [DASHBOARD] Queue dashboard at ${QUEUE_DASHBOARD_PATH} (read-only).`,
		);
	}

	/** Fecha os `Queue` e a conexão de leitura. Nunca lança. */
	async onApplicationShutdown(): Promise<void> {
		const opened = this.opened;
		if (!opened) return;
		this.opened = undefined;
		await Promise.allSettled(opened.queues.map((queue) => queue.close()));
		opened.connection.disconnect();
	}
}
