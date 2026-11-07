import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request } from "express";
import type { Env } from "@/config/env.schema.js";

export const isInternalSecret = (
	config: ConfigService<Env, true>,
	token: unknown,
): boolean => {
	const secret = config.get("INTERNAL_SECRET", { infer: true })?.trim();
	return !!secret && token === secret;
};

/**
 * Recusa com 401 quem não manda o `internal_secret`, **antes** da validação do
 * corpo: guard roda antes de pipe, e quem não tem o token não precisa saber as
 * regras dos campos.
 *
 * Serve às rotas sem modo demonstração. `research` não pode usá-lo: lá, token
 * errado responde 200 com o demo (`docs/nest-conceitos.md` §6).
 */
@Injectable()
export class InternalSecretGuard implements CanActivate {
	constructor(private readonly config: ConfigService<Env, true>) {}

	canActivate(context: ExecutionContext): boolean {
		const { body } = context.switchToHttp().getRequest<Request>();
		if (isInternalSecret(this.config, body?.internal_secret)) return true;

		throw new UnauthorizedException({
			success: false,
			error: "Invalid internal_secret",
		});
	}
}
