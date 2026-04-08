import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"@": resolve(__dirname, "src"),
		},
	},
	test: {
		globals: true,
		include: ["test/unit/**/*.test.ts", "test/integration/**/*.test.ts"],
	},
});
