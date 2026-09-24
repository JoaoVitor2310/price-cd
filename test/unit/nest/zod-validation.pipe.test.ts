import { describe, expect, it } from "vitest";
import * as z from "zod";
import { ZodValidationPipe } from "@/nest/common/zod-validation.pipe.js";

const metadata = { type: "body" } as const;

describe("ZodValidationPipe", () => {
	const schema = z.strictObject({
		minPopularity: z.number(),
		gameNames: z.array(z.string()).min(1),
	});
	const pipe = new ZodValidationPipe(schema);

	it("returns the parsed value when the payload is valid", () => {
		const result = pipe.transform(
			{ minPopularity: 30, gameNames: ["Hades"] },
			metadata,
		);

		expect(result).toEqual({ minPopularity: 30, gameNames: ["Hades"] });
	});

	it("lets the ZodError escape instead of handling it", () => {
		// É o contrato que faz o AllExceptionsFilter existir: o pipe valida, o
		// filter decide o formato da resposta. Se o pipe tratasse o erro, cada
		// rota precisaria repetir a tradução — o problema que a migração resolve.
		expect(() => pipe.transform({}, metadata)).toThrowError(z.ZodError);
	});

	it("applies the schema's own coercion and stripping rules", () => {
		const trimming = z.object({ steam_id: z.string().trim() });

		expect(
			new ZodValidationPipe(trimming).transform({ steam_id: "  765  " }, metadata),
		).toEqual({ steam_id: "765" });
	});

	it("rejects unknown fields when the schema is strict", () => {
		expect(() =>
			pipe.transform(
				{ minPopularity: 30, gameNames: ["Hades"], extra: true },
				metadata,
			),
		).toThrowError(z.ZodError);
	});
});
