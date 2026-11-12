import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * HTTP Basic Auth para o painel das filas (ADR 0011). Um usuário só, vindo do
 * ambiente: o painel é ferramenta de quem opera o price-cd, não tem contas.
 *
 * Express puro, e não um guard do Nest: o Bull Board é um router Express montado
 * por fora das rotas do Nest (`app.use`), e guard só vale para handler de
 * controller.
 *
 * A comparação é em tempo constante (`timingSafeEqual` do Node), sobre o
 * SHA-256 de cada lado: os dois buffers ficam do mesmo tamanho, e o tempo da
 * resposta não diz quantos caracteres acertaram nem o tamanho da senha. Usuário
 * e senha são sempre os dois comparados, para o tempo não dizer qual errou.
 */
export const basicAuth = (credentials: {
	user: string;
	password: string;
	realm: string;
}): RequestHandler => {
	const expectedUser = digest(credentials.user);
	const expectedPassword = digest(credentials.password);

	return (req, res, next) => {
		const given = readBasicCredentials(req.headers.authorization);
		if (given) {
			const userMatches = timingSafeEqual(digest(given.user), expectedUser);
			const passwordMatches = timingSafeEqual(
				digest(given.password),
				expectedPassword,
			);
			if (userMatches && passwordMatches) {
				next();
				return;
			}
		}

		res.setHeader(
			"WWW-Authenticate",
			`Basic realm="${credentials.realm}", charset="UTF-8"`,
		);
		res.status(401).send("Authentication required.");
	};
};

const digest = (value: string): Buffer =>
	createHash("sha256").update(value, "utf8").digest();

/**
 * `Basic base64(user:password)`; a senha pode conter `:`, o usuário não. O
 * esquema não diferencia maiúsculas, e entre ele e as credenciais pode haver
 * mais de um espaço (RFC 7235).
 */
const BASIC_HEADER = /^basic[ \t]+(\S+)[ \t]*$/i;

export const readBasicCredentials = (
	header: string | undefined,
): { user: string; password: string } | undefined => {
	const encoded = header?.match(BASIC_HEADER)?.[1];
	if (!encoded) return undefined;

	const decoded = Buffer.from(encoded, "base64").toString("utf8");
	const separator = decoded.indexOf(":");
	if (separator < 0) return undefined;
	return {
		user: decoded.slice(0, separator),
		password: decoded.slice(separator + 1),
	};
};
