import { resolve } from "node:path";
import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
	/**
	 * SWC no lugar do esbuild (transform padrão do Vitest) por uma razão só: o
	 * esbuild NÃO emite `design:paramtypes`, e sem essa metadata o container do
	 * Nest resolve dependência por tipo como `undefined` — sem erro no boot,
	 * estourando só na chamada da rota. Medido no spike do PR 0; ver
	 * `docs/adr/0004-nest-como-camada-de-apresentacao.md`.
	 *
	 * Trocar isto por outro transform reintroduz a falha silenciosa. A
	 * configuração de decorators fica no `.swcrc`, alinhada com o
	 * `tsconfig.json`.
	 */
	plugins: [swc.vite()],
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		include: [
			"test/unit/**/*.test.ts",
			"test/integration/**/*.test.ts",
			"test/contract/**/*.test.ts",
		],
		typecheck: {
			tsconfig: "./tsconfig.test.json",
		},
	},
});
