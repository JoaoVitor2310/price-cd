import { describe, expect, it } from "vitest";
import { acceptsPayment } from "@/domain/suppliers/payment-clauses.js";

/** Um meio de pagamento qualquer: a regra de negação não deve depender de qual seja. */
const WIDGETS = /widgets?/i;

describe("acceptsPayment", () => {
	it("accepts a plain mention", () => {
		expect(acceptsPayment("widgets", WIDGETS)).toBe(true);
	});

	it("does not accept a text without the mention", () => {
		expect(acceptsPayment("gadgets only", WIDGETS)).toBe(false);
	});

	it("does not accept an empty text", () => {
		expect(acceptsPayment("", WIDGETS)).toBe(false);
	});

	describe("negation", () => {
		it.each(["no widgets", "not widgets", "never widgets", "I don't want widgets", "rarely widgets"])(
			"rejects %j: the negation comes before the mention",
			(text) => {
				expect(acceptsPayment(text, WIDGETS)).toBe(false);
			},
		);

		it("accepts a mention whose negation is about something else, in another clause", () => {
			expect(acceptsPayment("no gadgets, widgets", WIDGETS)).toBe(true);
			expect(acceptsPayment("widgets - no gadgets", WIDGETS)).toBe(true);
		});

		it("accepts a mention that comes before a negation in the same clause", () => {
			// A negação só conta quando precede a menção.
			expect(acceptsPayment("widgets no gadgets", WIDGETS)).toBe(true);
		});

		it("treats each clause on its own", () => {
			expect(acceptsPayment("no widgets; widgets ok", WIDGETS)).toBe(true);
		});
	});

	describe("a bare refusal after the mention", () => {
		it.each(["widgets? not interested", "widgets. no thanks", "widgets, nope", "widgets / not accepting"])(
			"rejects %j: the refusal can only be about the mention",
			(text) => {
				expect(acceptsPayment(text, WIDGETS)).toBe(false);
			},
		);

		it("does not let a refusal WITH a complement contaminate the mention", () => {
			// "no gadgets" fala de outro meio de pagamento.
			expect(acceptsPayment("widgets, no gadgets", WIDGETS)).toBe(true);
		});

		it("does not let a lone 'no' contaminate the mention", () => {
			// Em "widgets, gadgets? no" a recusa é dos gadgets.
			expect(acceptsPayment("widgets, gadgets? no", WIDGETS)).toBe(true);
		});
	});

	it("gives the same answer when the same text is asked twice", () => {
		// Uma regex com a flag `g` guarda `lastIndex` e responderia diferente na segunda vez.
		expect(acceptsPayment("widgets", WIDGETS)).toBe(true);
		expect(acceptsPayment("widgets", WIDGETS)).toBe(true);
	});
});
