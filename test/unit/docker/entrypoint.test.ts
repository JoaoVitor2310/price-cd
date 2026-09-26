import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Os entrypoints de container são código de produção: eles decidem **qual app
 * sobe**. Uma troca errada aqui é um cutover acidental, ou um rollback que não
 * rola.
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

function runEntrypoint(script: string, appEntrypoint?: string): Run {
	try {
		const output = execFileSync("bash", [script], {
			env: {
				...process.env,
				PATH: `${stubs}:${process.env.PATH}`,
				...(appEntrypoint === undefined ? {} : { APP_ENTRYPOINT: appEntrypoint }),
			},
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { output, status: 0 };
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; status?: number };
		return {
			output: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
			status: failure.status ?? 1,
		};
	}
}

describe("docker/start.sh", () => {
	const script = "docker/start.sh";

	it("runs the Express app when APP_ENTRYPOINT is unset", () => {
		// Default seguro: o merge do PR de cutover não pode trocar produção.
		const { output, status } = runEntrypoint(script);

		expect(status).toBe(0);
		expect(output).toContain("RAN node dist/server.js");
	});

	it.each(["express", "nest"])("runs the %s app when asked", (app) => {
		const expected = app === "nest" ? "dist/main.js" : "dist/server.js";

		expect(runEntrypoint(script, app).output).toContain(`RAN node ${expected}`);
	});

	it.each(["NEST", "Nest", "EXPRESS"])("accepts %s regardless of case", (app) => {
		// Quem edita isto no `.env` da VPS não deve ser punido por digitar "Nest".
		const { output, status } = runEntrypoint(script, app);

		expect(status).toBe(0);
		expect(output).toMatch(/RAN node dist\/(server|main)\.js/);
	});

	it("treats an empty value as unset and runs Express", () => {
		// `APP_ENTRYPOINT=` no `.env` é o jeito de alguém "desligar" a variável.
		// Cair no default seguro é melhor que recusar a subir.
		const { output, status } = runEntrypoint(script, "");

		expect(status).toBe(0);
		expect(output).toContain("RAN node dist/server.js");
	});

	it.each(["bogus", "-n", "dist/main.js"])(
		"refuses to start anything for %s",
		(app) => {
			// Falhar alto é o comportamento certo: subir o app errado em produção
			// é pior que não subir. `-n` está aqui porque uma versão anterior
			// normalizava a caixa com `echo`, que engoliria esse valor como flag
			// e produziria uma mensagem de erro sem conteúdo.
			const { output, status } = runEntrypoint(script, app);

			expect(status).toBe(1);
			expect(output).not.toContain("RAN node");
		},
	);
});

describe("docker/start.dev.sh", () => {
	const script = "docker/start.dev.sh";

	it("runs the Express dev script by default", () => {
		expect(runEntrypoint(script).output).toContain("RAN npm run dev");
	});

	it("runs the Nest dev script when asked", () => {
		expect(runEntrypoint(script, "nest").output).toContain("RAN npm run dev:nest");
	});

	it("refuses an unknown value", () => {
		const { status, output } = runEntrypoint(script, "bogus");

		expect(status).toBe(1);
		expect(output).not.toContain("RAN npm");
	});
});
