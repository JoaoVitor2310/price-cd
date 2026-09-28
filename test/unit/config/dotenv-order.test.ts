import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const MAIN = new URL("../../../src/main.ts", import.meta.url).pathname;

const importedModules = (source: string): string[] =>
	source
		.split("\n")
		.map(
			(line) =>
				/^import\s.*?["'](?<from>[^"']+)["'];?\s*$/.exec(line)?.groups?.from,
		)
		.filter((from): from is string => from !== undefined);

/**
 * Trava a ordem dos imports do entrypoint.
 *
 * Import de ESM é hoisted e avaliado na ordem em que aparece, e o
 * `AppConfigModule` valida o ambiente **no momento em que é importado**. Se o
 * `dotenv` vier depois dele, toda variável com default no schema fica congelada
 * no default e o `.env` passa a ser ignorado em silêncio — inclusive
 * `BUMP_SCHEDULER_ENABLED`, o interruptor que evita dois processos comentando no
 * SteamTrades com a mesma conta.
 *
 * Nenhum teste de comportamento pega isso: o bug é de ordem de avaliação de
 * módulo, e importar `main.ts` num teste subiria o app de verdade. Então a
 * asserção é sobre o texto do arquivo, deliberadamente.
 */
describe("main.ts import order", () => {
	it("loads dotenv before anything that reads the environment", async () => {
		const imports = importedModules(await readFile(MAIN, "utf8"));
		const dotenv = imports.indexOf("dotenv/config");
		const firstAppImport = imports.findIndex((from) => from.startsWith("@/"));

		expect(dotenv, "src/main.ts must import dotenv/config").toBeGreaterThan(-1);
		expect(firstAppImport).toBeGreaterThan(dotenv);
	});
});
