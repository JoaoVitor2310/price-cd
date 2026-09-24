import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { afterEach, describe, expect, it } from "vitest";
import { AppConfigModule } from "@/nest/config/config.module.js";

/**
 * Trava a precedência de configuração.
 *
 * Existe porque o default do `@nestjs/config` faz o ARQUIVO `.env` vencer o que
 * já está em `process.env` — o oposto do que o `docker-compose.yml` assume,
 * onde o bloco `environment:` manda mais que o `env_file:`. Um `.env` esquecido
 * dentro da imagem sobrescreveria a configuração do deploy em silêncio.
 */
describe("config precedence", () => {
	const original = process.env.INTERNAL_SECRET;

	afterEach(() => {
		if (original === undefined) delete process.env.INTERNAL_SECRET;
		else process.env.INTERNAL_SECRET = original;
	});

	it("reads process.env, never the .env file", async () => {
		// O `.env` deste repo define INTERNAL_SECRET com outro valor; se o
		// ConfigModule voltar a lê-lo, este teste falha.
		process.env.INTERNAL_SECRET = "value-from-real-environment";

		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule],
		}).compile();

		expect(moduleRef.get(ConfigService).get("INTERNAL_SECRET")).toBe(
			"value-from-real-environment",
		);
		await moduleRef.close();
	});

	it("reports a variable as absent when the environment does not define it", async () => {
		delete process.env.INTERNAL_SECRET;

		const moduleRef = await Test.createTestingModule({
			imports: [AppConfigModule],
		}).compile();

		expect(moduleRef.get(ConfigService).get("INTERNAL_SECRET")).toBeUndefined();
		await moduleRef.close();
	});
});
