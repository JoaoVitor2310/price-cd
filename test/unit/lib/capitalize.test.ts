import { describe, expect, it } from "vitest";
import { capitalize } from "@/lib/capitalize.js";

describe("capitalize", () => {
	it("upper-cases only the first letter", () => {
		// É o que monta "Lists queue unavailable: ..." no `details` do 500.
		expect(capitalize("lists")).toBe("Lists");
		expect(capitalize("supplier discovery")).toBe("Supplier discovery");
	});

	it("leaves an empty string empty", () => {
		expect(capitalize("")).toBe("");
	});
});
