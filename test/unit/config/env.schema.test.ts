import { describe, expect, it } from "vitest";
import { validateEnv } from "@/config/env.schema.js";

describe("validateEnv", () => {
	it("applies the same defaults the code uses today", () => {
		const env = validateEnv({});

		expect(env.PORT).toBe(5555);
		expect(env.SERVER_TIMEOUT_MS).toBe(600_000);
		expect(env.RUN_LISTS_CONCURRENCY).toBe(1);
		expect(env.MAX_ACTIVE_LISTS).toBe(3);
		expect(env.NEW_SUPPLIERS_INTERVAL_HOURS).toBe(24);
		expect(env.NODE_ENV).toBe("development");
	});

	it("gives Nest a different default port so both apps run side by side", () => {
		expect(validateEnv({}).PORT_NEST).toBe(5557);
		expect(validateEnv({}).PORT_NEST).not.toBe(validateEnv({}).PORT);
	});

	it("treats an empty string as absent, not as zero", () => {
		// `.env.example` deixa quase tudo em branco — branco significa "default".
		const env = validateEnv({ PORT: "", SERVER_TIMEOUT_MS: "  " });

		expect(env.PORT).toBe(5555);
		expect(env.SERVER_TIMEOUT_MS).toBe(600_000);
	});

	it("coerces numeric strings", () => {
		expect(validateEnv({ PORT: "3000" }).PORT).toBe(3000);
	});

	it("rejects a non-numeric value and names the variable", () => {
		expect(() => validateEnv({ PORT: "abc" })).toThrow(/PORT must be an integer/);
	});

	it("rejects a negative or fractional number", () => {
		expect(() => validateEnv({ MAX_ACTIVE_LISTS: "-1" })).toThrow(
			/MAX_ACTIVE_LISTS/,
		);
		expect(() => validateEnv({ RUN_LISTS_CONCURRENCY: "1.5" })).toThrow(
			/RUN_LISTS_CONCURRENCY/,
		);
	});

	it("lists every problem at once instead of stopping at the first", () => {
		try {
			validateEnv({ PORT: "abc", MAX_ACTIVE_LISTS: "xyz" });
			expect.unreachable("should have thrown");
		} catch (error) {
			const message = (error as Error).message;
			expect(message).toContain("PORT");
			expect(message).toContain("MAX_ACTIVE_LISTS");
		}
	});

	it("splits USER_TO_IGNORE on commas and trims each id", () => {
		const env = validateEnv({ USER_TO_IGNORE: " 7656119, 7656118 ,, " });

		expect(env.USER_TO_IGNORE).toEqual(["7656119", "7656118"]);
	});

	it("defaults USER_TO_IGNORE to an empty list", () => {
		expect(validateEnv({}).USER_TO_IGNORE).toEqual([]);
	});

	it("reads USE_EXTERNAL_XVFB and DOCKER as strict 'true' flags", () => {
		expect(validateEnv({ USE_EXTERNAL_XVFB: "true" }).USE_EXTERNAL_XVFB).toBe(true);
		expect(validateEnv({ USE_EXTERNAL_XVFB: "1" }).USE_EXTERNAL_XVFB).toBe(false);
		expect(validateEnv({}).DOCKER).toBe(false);
	});

	it("rejects a malformed SISTEMA_ESTOQUE_URL", () => {
		expect(() => validateEnv({ SISTEMA_ESTOQUE_URL: "nao-e-url" })).toThrow(
			/SISTEMA_ESTOQUE_URL must be a valid URL/,
		);
	});

	describe("requirements that only apply in production", () => {
		const productionEnv = {
			NODE_ENV: "production",
			STEAMTRADES_SESSION: "session-cookie",
			SISTEMA_ESTOQUE_URL: "http://sistema-estoque.test",
			EXTERNAL_SECRET: "external",
		};

		it("accepts a fully configured production environment", () => {
			expect(validateEnv(productionEnv).NODE_ENV).toBe("production");
		});

		it.each(["STEAMTRADES_SESSION", "SISTEMA_ESTOQUE_URL", "EXTERNAL_SECRET"])(
			"refuses to boot in production without %s",
			(missing) => {
				const env: Record<string, unknown> = { ...productionEnv };
				delete env[missing];

				expect(() => validateEnv(env)).toThrow(
					new RegExp(`${missing} is required when NODE_ENV=production`),
				);
			},
		);

		it("never requires INTERNAL_SECRET — its absence is the demo mode", () => {
			// Contrato coberto em test/contract: sem o segredo,
			// POST /api/games/research responde 200 demo em vez de 403.
			expect(() => validateEnv(productionEnv)).not.toThrow();
		});

		it("boots in development with nothing configured", () => {
			expect(() => validateEnv({ NODE_ENV: "development" })).not.toThrow();
		});
	});
});
