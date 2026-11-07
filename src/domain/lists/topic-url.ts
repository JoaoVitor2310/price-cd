/** Um tópico do SteamTrades: o link já normalizado e o código que o identifica. */
export type SteamTradesTopicRef = {
	url: string;
	code: string;
};

const TOPIC_ORIGIN = "https://www.steamtrades.com";

/** `/trade/{code}` ou `/trade/{code}/slug`, e nada além disso. */
const TOPIC_PATH = /^\/trade\/([A-Za-z0-9]+)(?:\/[^/]+)?\/?$/;

/**
 * Lê o link de um tópico do SteamTrades, ou `null` se não for um.
 *
 * O navegador do price-cd vai abrir esse link, e ele chega no corpo da
 * requisição: conferir o prefixo não basta, porque
 * `https://www.steamtrades.com@evil.io/trade/abc` começa igual e abre outro host.
 * Por isso compara a origem **depois** do parser, que também resolve `..` no
 * caminho e recusa porta e usuário fora do padrão.
 *
 * O `url` devolvido não leva query nem fragmento: só o tópico é navegado.
 *
 * `URL` é o parser WHATWG, padrão da web e não API do Node — a regra continua
 * pura, como em `webhook-target.ts`.
 */
export const parseSteamTradesTopicUrl = (
	value: string,
): SteamTradesTopicRef | null => {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return null;
	}

	if (parsed.origin !== TOPIC_ORIGIN) return null;
	if (parsed.username || parsed.password) return null;

	const code = TOPIC_PATH.exec(parsed.pathname)?.[1];
	if (code === undefined) return null;

	return { url: `${TOPIC_ORIGIN}${parsed.pathname}`, code };
};
