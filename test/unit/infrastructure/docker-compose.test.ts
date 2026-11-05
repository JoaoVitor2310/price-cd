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

	it("declares both application services and one Redis for each", () => {
		// Um Redis por ambiente, com cache e fila em bancos lógicos (ADR 0009).
		expect([...blocks.keys()].sort()).toEqual([
			"price-researcher",
			"price-researcher-dev",
			"redis",
			"redis-dev",
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

	describe("production image", () => {
		it("comes from GHCR under a lowercase name, with an overridable tag for rollback", () => {
			expect(blocks.get("price-researcher")).toMatch(
				/^\s*image:\s*ghcr\.io\/[a-z0-9._/-]+:\$\{IMAGE_TAG:-latest\}\s*$/m,
			);
		});

		it("keeps a local build as the manual fallback when GHCR is down", () => {
			expect(blocks.get("price-researcher")).toMatch(/^\s*build:\s*\.\s*$/m);
		});

		it("is not shared with the dev service, which must keep building its own target", () => {
			// Se o dev herdasse o `image:` de produção, um `up` do dev sobrescreveria a tag local da imagem de produção.
			expect(blocks.get("price-researcher-dev")).not.toMatch(/^\s*image:/m);
		});
	});

	describe("Redis: price cache and research queue (ADR 0008, ADR 0009)", () => {
		it.each([
			["price-researcher", "redis"],
			["price-researcher-dev", "redis-dev"],
		])("%s points the cache at database 0 and the queue at database 1 of its own Redis, %s", (app, redis) => {
			// Produção e dev leem o mesmo `.env`: as URLs têm que vir do compose,
			// ou o dev gravaria no cache que a produção lê e consumiria pedidos
			// reais da fila. Bancos separados: limpar o cache (`-n 0 FLUSHDB`)
			// nunca apaga a fila.
			const block = blocks.get(app);
			expect(block).toMatch(new RegExp(`^\\s*REDIS_URL:\\s*redis://${redis}:6379/0\\s*$`, "m"));
			expect(block).toMatch(new RegExp(`^\\s*QUEUE_REDIS_URL:\\s*redis://${redis}:6379/1\\s*$`, "m"));
			expect(block).toMatch(new RegExp(`^\\s*${redis}:\\s*\\n\\s*condition:\\s*service_started\\s*$`, "m"));
		});

		it.each(["redis", "redis-dev"])("%s persists to an AOF on a volume and never evicts a key", (redis) => {
			// É a configuração que a fila exige: uma chave despejada é um pedido
			// perdido, ou um lock de job perdido — o job roda de novo e duplica a
			// Trade. O cache não precisa de despejo: toda entrada expira em 1h.
			const block = blocks.get(redis);
			expect(block).toMatch(/--appendonly yes/);
			expect(block).toMatch(/--maxmemory \d+mb/);
			expect(block).toMatch(/--maxmemory-policy noeviction/);
			expect(block).toMatch(new RegExp(`^\\s*-\\s*${redis}-data:/data\\s*$`, "m"));
		});

		it.each(["redis", "redis-dev"])("%s is never published on the host", (redis) => {
			expect(blocks.get(redis)).not.toMatch(/^\s*ports:/m);
		});

		it("keeps the dev Redis behind the dev profile", () => {
			// Sem perfil, um `up` sem argumento subiria o Redis do dev em produção.
			expect(blocks.get("redis-dev")).toMatch(/^\s*profiles:\s*\["dev"\]\s*$/m);
		});

		it.each(["price-researcher", "price-researcher-dev"])(
			"%s gives the ordered shutdown more than the 10s default",
			(app) => {
				// Fechar os três donos de Chromium pode passar de 10s; morto antes,
				// o Chromium fica órfão.
				const match = blocks.get(app)?.match(/^\s*stop_grace_period:\s*(\d+)s\s*$/m);
				expect(Number(match?.[1])).toBeGreaterThanOrEqual(60);
			},
		);
	});
});
