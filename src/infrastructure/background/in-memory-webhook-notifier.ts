import type {
	ResearchResult,
	ResearchResultNotifier,
	ResearchResultTarget,
} from "@/application/games/ports/research-result-notifier.port.js";
import type { HttpWebhookSender } from "@/infrastructure/webhooks/http-webhook-sender.js";
import { toWebhookBody } from "@/infrastructure/webhooks/webhook-body.js";

/**
 * A entrega do webhook sem Redis: o par do `InMemoryResearchQueue`, só fora de
 * produção. Uma tentativa, sem repetir — falha vai para o log.
 *
 * Entrega em segundo plano: `notify` resolve assim que o envio começa, como a
 * versão durável resolve quando o aviso está guardado.
 */
export class InMemoryWebhookNotifier implements ResearchResultNotifier {
	constructor(private readonly sender: Pick<HttpWebhookSender, "send">) {}

	async notify(
		target: ResearchResultTarget,
		result: ResearchResult,
	): Promise<void> {
		this.sender
			.send(target.webhookUrl, toWebhookBody(target.requestUuid, result))
			.then(() =>
				console.log(
					`📨 [WEBHOOK] Delivered the result of request ${target.requestUuid}.`,
				),
			)
			.catch((error) =>
				console.warn(
					`⚠️ [WEBHOOK] Delivery of request ${target.requestUuid} failed, not retried without QUEUE_REDIS_URL:`,
					error,
				),
			);
	}

	/** Nada guardado para entregar de novo. */
	async redeliver(_requestUuid: string): Promise<boolean> {
		return false;
	}

	async forget(_requestUuid: string): Promise<void> {}
}
