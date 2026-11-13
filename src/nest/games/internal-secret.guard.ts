import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { Env } from "@/config/env.schema.js";
import { constantTimeEqual } from "@/lib/constant-time-equal.js";

/**
 * Quem pediu a pesquisa, pelo token que mandou em `internal_secret`. Ver
 * `docs/adr/0012-um-token-por-consumidor-da-pesquisa.md`.
 *
 * - `internal`: o `INTERNAL_SECRET` — a interface web e o Sistema Estoque;
 * - `chatbot`: o `CHATBOT_INTERNAL_SECRET`, só do chatbot, para revogá-lo sem
 *   mexer nos outros.
 */
export type ResearchConsumer = "internal" | "chatbot";

const CONSUMER_SECRETS = [
	["internal", "INTERNAL_SECRET"],
	["chatbot", "CHATBOT_INTERNAL_SECRET"],
] as const satisfies ReadonlyArray<readonly [ResearchConsumer, keyof Env]>;

/**
 * O consumidor dono do token, ou `undefined` se ele não bate com nenhum segredo
 * configurado. Segredo ausente (ou vazio) não aceita nada.
 *
 * Compara com **todos** os segredos, sempre, em tempo constante: parar no
 * primeiro que casa diria pelo tempo de qual consumidor é o token.
 */
export const researchConsumer = (
	config: ConfigService<Env, true>,
	token: unknown,
): ResearchConsumer | undefined => {
	if (typeof token !== "string" || token === "") return undefined;

	let found: ResearchConsumer | undefined;
	for (const [consumer, key] of CONSUMER_SECRETS) {
		const secret = config.get(key, { infer: true })?.trim();
		if (secret && constantTimeEqual(token, secret)) found ??= consumer;
	}
	return found;
};

const logger = new Logger("ResearchAuth");

/**
 * Registra quem entrou, nunca o token: é o que diz se dá para revogar um. A rota
 * sai da própria requisição, nas duas rotas que autenticam.
 */
export const logResearchConsumer = (
	request: Pick<Request, "method" | "path">,
	consumer: ResearchConsumer,
): void => {
	logger.log(`${request.method} ${request.path} authenticated as ${consumer}`);
};

/**
 * Recusa com 401 quem não manda um token válido em `internal_secret`, **antes**
 * da validação do corpo: guard roda antes de pipe, e quem não tem o token não
 * precisa saber as regras dos campos.
 *
 * Serve às rotas sem modo demonstração. `research` não pode usá-lo: lá, token
 * errado responde 200 com o demo (`docs/nest-conceitos.md` §6).
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
	constructor(private readonly config: ConfigService<Env, true>) {}

	canActivate(context: ExecutionContext): boolean {
		const request = context.switchToHttp().getRequest<Request>();
		const consumer = researchConsumer(
			this.config,
			request.body?.internal_secret,
		);
		if (consumer) {
			logResearchConsumer(request, consumer);
			return true;
		}

		throw new UnauthorizedException({
			success: false,
			error: "Invalid internal_secret",
		});
	}
}
