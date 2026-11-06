/**
 * Se o price-cd pode chamar esta URL de webhook.
 *
 * A URL chega no corpo da requisição, e o price-cd roda dentro da rede interna
 * (Redis, Sistema Estoque): aceitar qualquer endereço seria deixar quem pede
 * escolher o que o price-cd chama por dentro (SSRF). Só passa:
 *
 * - `http` ou `https`;
 * - sem usuário/senha na URL;
 * - host **exatamente** igual a um da lista permitida, sem diferenciar
 *   maiúsculas. Igualdade, não sufixo: `chatbot.example.com.evil.io` não passa
 *   por `chatbot.example.com`.
 *
 * Conferido duas vezes: no recebimento do pedido (400) e no envio, porque a
 * lista pode ter mudado entre um e outro — o pedido sobrevive a deploys.
 *
 * Regra pura sobre texto: `URL` é o parser WHATWG, o mesmo do navegador.
 */
export const isAllowedWebhookTarget = (
	url: string,
	allowedHosts: readonly string[],
): boolean => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
	if (parsed.username || parsed.password) return false;

	const host = parsed.hostname.toLowerCase();
	return allowedHosts.some((allowed) => allowed.toLowerCase() === host);
};
