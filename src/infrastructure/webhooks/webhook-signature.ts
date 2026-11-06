import { createHmac } from "node:crypto";

/**
 * A assinatura do webhook (ver `docs/adr/0010-webhook-do-resultado-da-pesquisa.md`).
 *
 * O segredo **nunca trafega**: o price-cd manda só o HMAC-SHA256 de
 * `"<timestamp>.<corpo>"`, e quem recebe refaz a conta com o mesmo segredo. Bater
 * prova que a mensagem veio de quem tem o segredo e que o corpo não mudou no
 * caminho; o timestamp dentro do que é assinado deixa quem recebe recusar uma
 * mensagem antiga reenviada (replay).
 *
 * É o modelo de GitHub e Stripe. `node:crypto`, sem dependência.
 */
export const WEBHOOK_TIMESTAMP_HEADER = "X-Webhook-Timestamp";
export const WEBHOOK_SIGNATURE_HEADER = "X-Webhook-Signature";

/**
 * `timestamp` em segundos Unix, como texto — exatamente o que vai no cabeçalho.
 * `body` é o corpo **bruto**, byte a byte o que vai na requisição: assinar o
 * objeto e serializar de novo depois daria outra string.
 */
export const signWebhook = (
	secret: string,
	timestamp: string,
	body: string,
): string =>
	`sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
