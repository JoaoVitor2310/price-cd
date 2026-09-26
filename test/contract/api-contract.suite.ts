import type { Server } from "node:http";
import type { Express } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT_CASES } from "./contract-cases.js";

type ServerLike = Server | Express;

/**
 * Como um app específico participa da bateria de contrato.
 *
 * `withEnv` existe porque os dois apps leem configuração de formas
 * incompatíveis: o Express lê `process.env` a cada request, enquanto o Nest
 * **valida e congela** o ambiente no boot (`ConfigModule`, `cache: true`).
 * Mutar `process.env` no meio do teste funcionaria só no Express — os casos de
 * `INTERNAL_SECRET` passariam de um lado e mentiriam do outro. Então cada app
 * responde por conta própria como honrar o ambiente de um caso; o app Nest
 * (PR 3) precisará reconstruir o módulo de teste.
 */
export type ContractApp = {
	/** Resolve o servidor na hora do teste — o app Nest só existe após `init()`. */
	getServer: () => ServerLike;
	/** Roda `run` com o ambiente do caso aplicado, e restaura depois. */
	withEnv: <T>(
		env: Record<string, string | undefined>,
		run: () => Promise<T>,
	) => Promise<T>;
};

export function runApiContract({
	getServer,
	withEnv,
	only,
}: ContractApp): void {
	// Sem opt-in por rota: os dois apps são cobrados pela bateria inteira.
	// O parâmetro `only` existiu dos PRs 3 a 7, enquanto o Nest só podia
	// responder pelas rotas já migradas, e foi removido no PR 8 — o git guarda.
	const cases = CONTRACT_CASES;

	describe.each(cases)("$method $route — $name", (contractCase) => {
		it("matches the contract", async () => {
			const response = await withEnv(contractCase.env ?? {}, async () => {
				const agent = request(getServer());
				const call =
					contractCase.method === "get"
						? agent.get(contractCase.route)
						: agent.post(contractCase.route).send(contractCase.body ?? {});

				return call.set(contractCase.headers ?? {});
			});

			expect(response.status).toBe(contractCase.expectStatus);
			if (contractCase.expectBody) {
				expect(response.body).toMatchObject(contractCase.expectBody);
			}
			if (contractCase.expectText) {
				expect(response.text).toContain(contractCase.expectText);
			}
		});
	});
}
