/**
 * A contenção de processos do container é configuração, não código — mas é
 * configuração que já derrubou a produção duas vezes (OOM em 2026-08-24,
 * esgotamento de PIDs por zumbis em 2026-09-18). Estes testes existem para que
 * remover qualquer uma dessas três linhas quebre a suíte em vez de quebrar a VPS.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const composePath = resolve(__dirname, "../../../docker-compose.yml");

/**
 * Lê os blocos de cada serviço do compose sem depender de um parser de YAML
 * (o projeto não tem um). Serviços são as chaves com 2 espaços de indentação
 * dentro de `services:`; o bloco vai até a próxima chave nesse mesmo nível.
 */
const readServiceBlocks = (): Map<string, string> => {
	const lines = readFileSync(composePath, "utf8").split("\n");
	const blocks = new Map<string, string>();

	let inServices = false;
	let current: string | null = null;
	let buffer: string[] = [];

	const flush = () => {
		if (current) blocks.set(current, buffer.join("\n"));
		current = null;
		buffer = [];
	};

	for (const line of lines) {
		if (/^\S/.test(line)) {
			// chave de topo: entra ou sai do bloco `services:`
			flush();
			inServices = line.startsWith("services:");
			continue;
		}
		if (!inServices) continue;

		const serviceHeader = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
		if (serviceHeader) {
			flush();
			current = serviceHeader[1];
			continue;
		}
		if (current) buffer.push(line);
	}
	flush();

	return blocks;
};

describe("docker-compose", () => {
	const blocks = readServiceBlocks();

	it("declares both application services", () => {
		expect([...blocks.keys()].sort()).toEqual([
			"price-researcher",
			"price-researcher-dev",
		]);
	});

	it.each([...readServiceBlocks().keys()])(
		"%s runs with a real init as PID 1",
		(service) => {
			// Sem init, o Node vira PID 1 e não colhe os netos do Chromium
			// reparentados: cada um vira zumbi e consome um slot do pids_limit.
			expect(blocks.get(service)).toMatch(/^\s*init:\s*true\s*$/m);
		},
	);

	it.each([...readServiceBlocks().keys()])(
		"%s keeps the PID and memory ceilings",
		(service) => {
			const block = blocks.get(service);
			expect(block).toMatch(/^\s*pids_limit:\s*\d+\s*$/m);
			expect(block).toMatch(/^\s*mem_limit:\s*\S+\s*$/m);
		},
	);
});
