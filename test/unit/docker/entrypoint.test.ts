import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Os entrypoints de container são código de produção: eles decidem **o que
 * sobe**. Um caminho errado aqui é um container que não serve nada, e o erro só
 * aparece em deploy.
 *
 * Testá-los não exige Docker nem subir nada: basta pôr `Xvfb`, `node`, `npm` e
 * `sleep` falsos no `PATH` e olhar o que o script tenta executar no fim.
 */
const stubs = mkdtempSync(path.join(tmpdir(), "entrypoint-stubs-"));

const stub = (name: string, body: string): void => {
	const file = path.join(stubs, name);
	writeFileSync(file, `#!/bin/sh\n${body}\n`);
	chmodSync(file, 0o755);
};

beforeAll(() => {
	stub("Xvfb", "exit 0");
	stub("sleep", "exit 0"); // o script espera o socket do display; aqui não há display
	stub("node", 'echo "RAN node $*"');
	stub("npm", 'echo "RAN npm $*"');
	stub("rm", "exit 0"); // limpeza de lock de display, irrelevante no teste
	stub("pkill", "exit 0");
});

type Run = { output: string; status: number };

function runEntrypoint(script: string): Run {
	try {
		const output = execFileSync("bash", [script], {
			env: { ...process.env, PATH: `${stubs}:${process.env.PATH}` },
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { output, status: 0 };
	} catch (error) {
		const failure = error as {
			stdout?: string;
			stderr?: string;
			status?: number;
		};
		return {
			output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
			status: failure.status ?? 1,
		};
	}
}

describe("docker/start.sh", () => {
	it("starts the compiled Nest app", () => {
		// Durante o cutover este script escolhia entre dois apps por
		// `APP_ENTRYPOINT`. Com o Express removido sobrou um entrypoint — e o teste
		// continua valendo, porque é ele que decide o que sobe em produção.
		const { output, status } = runEntrypoint("docker/start.sh");

		expect(status).toBe(0);
		expect(output).toContain("RAN node dist/main.js");
	});

	it("never starts the removed Express entrypoint", () => {
		// Guarda contra um revert parcial: `dist/server.js` não existe mais.
		expect(runEntrypoint("docker/start.sh").output).not.toContain("server.js");
	});
});

describe("docker/start.dev.sh", () => {
	it("starts the dev server", () => {
		const { output, status } = runEntrypoint("docker/start.dev.sh");

		expect(status).toBe(0);
		expect(output).toContain("RAN npm run dev");
	});
});
