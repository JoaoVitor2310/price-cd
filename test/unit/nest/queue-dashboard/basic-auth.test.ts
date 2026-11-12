import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
	basicAuth,
	readBasicCredentials,
} from "@/nest/queue-dashboard/basic-auth.js";

const credentials = {
	user: "ops",
	password: "a-long-enough-password",
	realm: "price-cd queues",
};

const header = (user: string, password: string) =>
	`Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

function call(authorization?: string) {
	const req = { headers: { authorization } } as Request;
	const res = {
		setHeader: vi.fn(),
		status: vi.fn().mockReturnThis(),
		send: vi.fn(),
	};
	const next = vi.fn();
	basicAuth(credentials)(req, res as unknown as Response, next);
	return { res, next };
}

describe("basicAuth", () => {
	it("lets the configured user through", () => {
		const { res, next } = call(header("ops", "a-long-enough-password"));

		expect(next).toHaveBeenCalledTimes(1);
		expect(res.status).not.toHaveBeenCalled();
	});

	it.each([
		["no header", undefined],
		["a wrong password", header("ops", "wrong")],
		["a wrong user", header("admin", "a-long-enough-password")],
		["another scheme", "Bearer token"],
		[
			"no colon in the credentials",
			`Basic ${Buffer.from("ops").toString("base64")}`,
		],
	])("answers 401 with a challenge for %s", (_label, authorization) => {
		const { res, next } = call(authorization);

		expect(next).not.toHaveBeenCalled();
		expect(res.status).toHaveBeenCalledWith(401);
		expect(res.setHeader).toHaveBeenCalledWith(
			"WWW-Authenticate",
			'Basic realm="price-cd queues", charset="UTF-8"',
		);
	});
});

describe("readBasicCredentials", () => {
	it("keeps a colon inside the password", () => {
		expect(readBasicCredentials(header("ops", "pa:ss"))).toEqual({
			user: "ops",
			password: "pa:ss",
		});
	});

	it("accepts more than one space between the scheme and the credentials", () => {
		const encoded = Buffer.from("ops:secret").toString("base64");

		expect(readBasicCredentials(`Basic  \t${encoded}`)).toEqual({
			user: "ops",
			password: "secret",
		});
	});

	it("refuses a header with nothing after the scheme", () => {
		expect(readBasicCredentials("Basic ")).toBeUndefined();
	});

	it("accepts the scheme in any case", () => {
		const encoded = Buffer.from("ops:secret").toString("base64");

		expect(readBasicCredentials(`basic ${encoded}`)).toEqual({
			user: "ops",
			password: "secret",
		});
	});
});
