import type { ArgumentsHost } from "@nestjs/common";
import { BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { AllExceptionsFilter } from "@/nest/common/all-exceptions.filter.js";

/** Host mínimo: só o suficiente para capturar status e corpo da resposta. */
function fakeHost() {
	const json = vi.fn();
	const status = vi.fn(() => ({ json }));
	const host = {
		switchToHttp: () => ({ getResponse: () => ({ status }) }),
	} as unknown as ArgumentsHost;

	return { host, status, json };
}

const zodErrorFrom = (schema: z.ZodType, value: unknown): z.ZodError => {
	const result = schema.safeParse(value);
	if (result.success) throw new Error("schema should have failed");
	return result.error;
};

describe("AllExceptionsFilter", () => {
	const filter = new AllExceptionsFilter();

	it("turns a ZodError into a 400 with error and concatenated details", () => {
		const { host, status, json } = fakeHost();
		const schema = z.object({ minPopularity: z.number(), gameNames: z.array(z.string()) });

		filter.catch(zodErrorFrom(schema, {}), host);

		expect(status).toHaveBeenCalledWith(400);
		expect(json).toHaveBeenCalledWith({
			success: false,
			error: "Validation failed",
			details: expect.stringContaining("minPopularity"),
		});
	});

	it("joins multiple Zod issues into a single comma-separated string", () => {
		const { host, json } = fakeHost();
		const schema = z.object({ a: z.number(), b: z.number() });

		filter.catch(zodErrorFrom(schema, {}), host);

		const details = json.mock.calls[0][0].details as string;
		expect(details).toContain("a:");
		expect(details).toContain("b:");
		expect(details).toContain(", ");
	});

	it("preserves the status and body of an HttpException", () => {
		const { host, status, json } = fakeHost();

		filter.catch(new BadRequestException({ success: false, custom: true }), host);

		expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
		expect(json).toHaveBeenCalledWith({ success: false, custom: true });
	});

	it("wraps the message when the HttpException carries only a string", () => {
		const { host, status, json } = fakeHost();

		filter.catch(new HttpException("nope", HttpStatus.FORBIDDEN), host);

		expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
		expect(json).toHaveBeenCalledWith({ success: false, error: "nope" });
	});

	it("turns an unknown Error into a 500 with the message in details", () => {
		const { host, status, json } = fakeHost();

		filter.catch(new Error("browser died"), host);

		expect(status).toHaveBeenCalledWith(500);
		expect(json).toHaveBeenCalledWith({
			success: false,
			error: "Internal server error.",
			details: "browser died",
		});
	});

	it("never leaks the stack trace into the response", () => {
		const { host, json } = fakeHost();
		const error = new Error("boom");

		filter.catch(error, host);

		expect(JSON.stringify(json.mock.calls[0][0])).not.toContain("at ");
	});

	it("handles a thrown value that is not an Error", () => {
		const { host, status, json } = fakeHost();

		filter.catch("a bare string", host);

		expect(status).toHaveBeenCalledWith(500);
		expect(json).toHaveBeenCalledWith({
			success: false,
			error: "Internal server error.",
			details: "Unknown error",
		});
	});
});
