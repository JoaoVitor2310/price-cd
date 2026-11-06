import { isAllowedWebhookTarget } from "@/application/games/webhook-target.js";
import type { WebhookBody } from "@/infrastructure/webhooks/webhook-body.js";
import {
	signWebhook,
	WEBHOOK_SIGNATURE_HEADER,
	WEBHOOK_TIMESTAMP_HEADER,
} from "@/infrastructure/webhooks/webhook-signature.js";

const TIMEOUT_MS = 10_000;

/**
 * O endereço deixou de estar na lista permitida entre o pedido e o envio. Não
 * adianta tentar de novo: quem entrega deve desistir na hora.
 */
export class WebhookTargetNotAllowedError extends Error {
	constructor(url: string) {
		// `URL.parse` devolve `null` em vez de lançar: uma URL ilegível também é
		// "não permitida", e um `TypeError` aqui faria a fila tentar de novo.
		super(
			`Webhook host is not allowed: ${URL.parse(url)?.hostname ?? "(unreadable URL)"}`,
		);
		this.name = "WebhookTargetNotAllowedError";
	}
}

/**
 * Uma tentativa de entrega do webhook. Resolve só com `2xx`; qualquer outra
 * coisa lança, e quem decide se tenta de novo é a fila.
 *
 * - **Allowlist de novo, aqui:** a lista pode ter mudado desde o pedido.
 * - **`redirect: "manual"`:** seguir um 3xx levaria o price-cd a um host que a
 *   lista nunca viu. Um redirect conta como falha.
 * - **Timestamp novo a cada tentativa:** quem recebe recusa assinatura velha, e
 *   uma nova tentativa horas depois precisa passar.
 */
export class HttpWebhookSender {
	constructor(
		private readonly signingSecret: string,
		private readonly allowedHosts: readonly string[],
	) {}

	async send(url: string, body: WebhookBody): Promise<void> {
		if (!isAllowedWebhookTarget(url, this.allowedHosts)) {
			throw new WebhookTargetNotAllowedError(url);
		}

		const raw = JSON.stringify(body);
		const timestamp = String(Math.floor(Date.now() / 1000));

		const response = await fetch(url, {
			method: "POST",
			signal: AbortSignal.timeout(TIMEOUT_MS),
			redirect: "manual",
			headers: {
				"Content-Type": "application/json",
				[WEBHOOK_TIMESTAMP_HEADER]: timestamp,
				[WEBHOOK_SIGNATURE_HEADER]: signWebhook(
					this.signingSecret,
					timestamp,
					raw,
				),
			},
			body: raw,
		});
		await response.body?.cancel();

		if (response.status < 200 || response.status >= 300) {
			throw new Error(`Webhook answered HTTP ${response.status}`);
		}
	}
}
