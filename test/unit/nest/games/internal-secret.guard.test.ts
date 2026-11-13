import type { ExecutionContext } from "@nestjs/common";
import { Logger, UnauthorizedException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "@/config/env.schema.js";
import {
	InternalSecretGuard,
	researchConsumer,
} from "@/nest/games/internal-secret.guard.js";

const INTERNAL = "internal-secret";
const CHATBOT = "chatbot-secret-0123456789abcdef0123456789";

const config = (values: Partial<Record<keyof Env, string | undefined>>) =>
	({ get: (key: keyof Env) => values[key] }) as unknown as ConfigService<
		Env,
		true
	>;

const both = config({
	INTERNAL_SECRET: INTERNAL,
	CHATBOT_INTERNAL_SECRET: CHATBOT,
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("researchConsumer", () => {
	it("tells the Sistema Estoque and web token from the chatbot's", () => {
		expect(researchConsumer(both, INTERNAL)).toBe("internal");
		expect(researchConsumer(both, CHATBOT)).toBe("chatbot");
	});

	it.each([
		["a wrong token", "wrong"],
		["an empty token", ""],
		["no token", undefined],
		["a token that is not a string", 42],
		["a prefix of a real token", INTERNAL.slice(0, -1)],
	])("accepts nobody with %s", (_label, token) => {
		expect(researchConsumer(both, token)).toBeUndefined();
	});

	it("accepts nothing for a consumer whose secret is not configured", () => {
		// Revogar o chatbot é tirar a variável dele: o token deixa de valer.
		const internalOnly = config({ INTERNAL_SECRET: INTERNAL });

		expect(researchConsumer(internalOnly, CHATBOT)).toBeUndefined();
		expect(researchConsumer(internalOnly, INTERNAL)).toBe("internal");
	});

	it("lets the chatbot in even without INTERNAL_SECRET", () => {
		expect(
			researchConsumer(config({ CHATBOT_INTERNAL_SECRET: CHATBOT }), CHATBOT),
		).toBe("chatbot");
	});

	it("never matches an empty configured secret", () => {
		expect(
			researchConsumer(config({ INTERNAL_SECRET: "   " }), ""),
		).toBeUndefined();
	});
});

describe("InternalSecretGuard", () => {
	const context = (internal_secret?: string) =>
		({
			switchToHttp: () => ({
				getRequest: () => ({
					method: "POST",
					path: "/api/games/research/from-topic",
					body: { internal_secret },
				}),
			}),
		}) as unknown as ExecutionContext;

	it("lets either consumer through, and logs which one without the token", () => {
		const log = vi.spyOn(Logger.prototype, "log").mockImplementation(() => {});
		const guard = new InternalSecretGuard(both);

		expect(guard.canActivate(context(CHATBOT))).toBe(true);
		expect(log).toHaveBeenCalledWith(
			"POST /api/games/research/from-topic authenticated as chatbot",
		);
		expect(log.mock.calls.flat().join("\n")).not.toContain(CHATBOT);
	});

	it("refuses a wrong token with 401", () => {
		const guard = new InternalSecretGuard(both);

		expect(() => guard.canActivate(context("wrong"))).toThrow(
			UnauthorizedException,
		);
	});
});
