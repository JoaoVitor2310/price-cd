import type { Server } from "node:http";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { CONTRACT_CASES } from "./contract-cases.js";

/**
 * Como o app participa da bateria de contrato.
 *
 * `withEnv` existe porque o Nest **valida e congela** o ambiente no boot
 * (`ConfigModule`, `cache: true`): mutar `process.env` no meio do teste não teria
 * efeito, e os casos de `INTERNAL_SECRET` mentiriam. Quem monta o app decide como
 * honrar o ambiente de um caso — em `nest.contract.test.ts`, reconstruindo o app.
 */
export type ContractApp = {
	/** Resolve o servidor na hora do teste — o app só existe após `init()`. */
	getServer: () => Server;
	/** Roda `run` com o ambiente do caso aplicado, e restaura depois. */
	withEnv: <T>(
		env: Record<string, string | undefined>,
		run: () => Promise<T>,
	) => Promise<T>;
};

export function runApiContract({
	getServer,
	withEnv,
}: ContractApp): void {
	describe.each(CONTRACT_CASES)("$method $route — $name", (contractCase) => {
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
