import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("../../../src/", import.meta.url).pathname;

const filesUnder = async (dir: string): Promise<string[]> => {
	const entries = await readdir(join(SRC, dir), {
		recursive: true,
		withFileTypes: true,
	});

	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
		.map((entry) => join(entry.parentPath, entry.name));
};

/**
 * Remove comentários antes da busca.
 *
 * Um docblock que **fala** sobre `@nestjs/*` — e este projeto tem vários,
 * explicando justamente esta fronteira — não é uma violação. Tira blocos
 * `/* *\/` e linhas que são só comentário; um `//` no fim de uma linha de código
 * fica, porque nenhum comentário de fim de linha carrega um especificador de
 * módulo entre aspas.
 */
const withoutComments = (source: string): string =>
	source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\*)/.test(line))
		.join("\n");

/**
 * Os especificadores de módulo do arquivo, venha o import de onde vier.
 *
 * Casa o **especificador**, não a linha do `import`. A primeira versão deste
 * teste filtrava linhas que começavam com `import`/`export`, e por isso deixava
 * passar exatamente o estilo dominante do repo:
 *
 * ```ts
 * import {
 * 	Injectable,
 * } from "@nestjs/common";   // ← o "@nestjs/..." não está na linha do import
 * ```
 *
 * Verificado por mutação: uma violação escrita assim passava verde. Esta versão
 * pega também `export ... from`, `import "efeito-colateral"` e
 * `await import("...")`.
 */
const moduleSpecifiers = (source: string): string[] =>
	[
		...withoutComments(source).matchAll(
			/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g,
		),
	].map((match) => match[1]);

const nestImportsUnder = async (dir: string) => {
	const offenders: string[] = [];

	for (const file of await filesUnder(dir)) {
		const found = moduleSpecifiers(await readFile(file, "utf8")).filter(
			(specifier) => specifier.startsWith("@nestjs/"),
		);

		if (found.length > 0) {
			offenders.push(
				`${file.replace(SRC, "")}: ${[...new Set(found)].join(", ")}`,
			);
		}
	}

	return offenders;
};

/**
 * A fronteira de camadas, verificada em vez de prometida.
 *
 * O plano da migração dizia que isto seria um `grep` no CI e nunca foi escrito.
 * Como teste é melhor: roda no `npm test`, local e no CI, e falha nomeando o
 * arquivo. Sem esta trava, "o que sobrou de clean architecture no projeto vira
 * decoração" — é o custo real de uma violação, não uma preferência de estilo.
 */
describe("layer boundary", () => {
	for (const layer of ["domain", "application", "helpers"]) {
		it(`keeps ${layer}/ free of any @nestjs import`, async () => {
			// Estas camadas não podem saber que existe um framework: é o que
			// permite testá-las sem container e trocar a apresentação de novo.
			expect(await nestImportsUnder(layer)).toEqual([]);
		});
	}

	for (const layer of ["infrastructure", "lib"]) {
		it(`lets ${layer}/ import nothing beyond @nestjs/common`, async () => {
			// Adapters podem ganhar `@Injectable()` — só isso. `@nestjs/core`,
			// `@nestjs/config` e afins pertencem ao wiring, em nest/.
			const outside = (await nestImportsUnder(layer)).filter(
				(offender) => !offender.includes("@nestjs/common"),
			);

			expect(outside).toEqual([]);
		});
	}
});
