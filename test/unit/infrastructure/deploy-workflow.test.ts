/**
 * O deploy foi tirado da VPS (CPU emprestada, steal de 60-80%): o CI constrói a
 * imagem, publica no GHCR e a VPS só faz pull. É configuração, mas configuração
 * que falha em silêncio — um nome de imagem diferente entre workflow e compose
 * faz a VPS puxar uma imagem velha sem erro nenhum. Estes testes travam isso.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const workflow = readFileSync(resolve(root, ".github/workflows/deploy.yml"), "utf8");
const compose = readFileSync(resolve(root, "docker-compose.yml"), "utf8");

/** Texto de um job, da chave `  nome:` até o próximo job (ou o fim do arquivo). */
const jobBlock = (name: string): string => {
	const lines = workflow.split("\n");
	const start = lines.findIndex((line) => line === `  ${name}:`);
	if (start === -1) throw new Error(`job "${name}" not found in deploy.yml`);
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line));
	// Sem linhas de comentário: um "# sem --build" explicativo não pode contar como uso de --build.
	return rest
		.slice(0, end === -1 ? undefined : end)
		.filter((line) => !/^\s*#/.test(line))
		.join("\n");
};

describe("deploy workflow", () => {
	it("publishes the same image name the compose file pulls", () => {
		const workflowImage = workflow.match(/^\s*IMAGE:\s*(\S+)\s*$/m)?.[1];
		const composeImage = compose.match(/^\s*image:\s*(ghcr\.io\/[^:\s$]+)/m)?.[1];

		expect(workflowImage).toBeDefined();
		expect(composeImage).toBe(workflowImage);
	});

	it("uses a lowercase image name, which GHCR requires", () => {
		const image = workflow.match(/^\s*IMAGE:\s*(\S+)\s*$/m)?.[1] ?? "";

		expect(image).toBe(image.toLowerCase());
	});

	describe("build job", () => {
		const build = jobBlock("build");

		it("pushes the image and may write packages", () => {
			expect(build).toMatch(/^\s*packages:\s*write\s*$/m);
			expect(build).toMatch(/^\s*push:\s*true\s*$/m);
		});

		it("builds the commit CI approved, not whatever main moved to since", () => {
			expect(build).toContain("github.event.workflow_run.head_sha");
			expect(build).toMatch(/ref:\s*\$\{\{\s*env\.SHA\s*\}\}/);
		});

		it("tags latest and a commit-specific tag for rollback", () => {
			expect(build).toMatch(/:latest\b/);
			expect(build).toMatch(/:sha-\$\{\{\s*env\.SHA\s*\}\}/);
		});

		it("caches layers in GitHub so the Chromium install does not depend on the VPS cache", () => {
			expect(build).toMatch(/cache-from:\s*type=gha/);
			expect(build).toMatch(/cache-to:\s*type=gha,mode=max/);
		});

		it("links the package to the repository so the deploy job token can pull it", () => {
			expect(build).toContain("org.opencontainers.image.source=");
		});
	});

	describe("deploy job", () => {
		const deploy = jobBlock("deploy");

		it("runs only after the image was published", () => {
			expect(deploy).toMatch(/^\s*needs:\s*build\s*$/m);
		});

		it("never builds on the VPS", () => {
			expect(deploy).not.toMatch(/--build/);
			expect(deploy).not.toMatch(/docker build/);
		});

		it("pulls explicitly before bringing the service up, and stops if the pull fails", () => {
			expect(deploy).toMatch(/^\s*set -eu\s*$/m);
			expect(deploy.indexOf("docker compose pull price-researcher")).toBeGreaterThan(-1);
			expect(deploy.indexOf("docker compose pull price-researcher")).toBeLessThan(
				deploy.indexOf("docker compose up -d price-researcher"),
			);
		});

		it("authenticates with the job token and removes the credential even on failure", () => {
			expect(deploy).toMatch(/^\s*packages:\s*read\s*$/m);
			expect(deploy).toMatch(/envs:\s*GHCR_USER,GHCR_TOKEN/);
			expect(deploy).toMatch(/trap 'docker logout ghcr\.io' EXIT/);
		});
	});

	it("serialises deploys so two runs never fight over the same container", () => {
		expect(workflow).toMatch(/^concurrency:\s*\n\s+group:\s*deploy\s*\n\s+cancel-in-progress:\s*false/m);
	});
});
