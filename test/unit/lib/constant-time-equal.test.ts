import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "@/lib/constant-time-equal.js";

describe("constantTimeEqual", () => {
	it("matches the same secret", () => {
		expect(constantTimeEqual("s3cret", "s3cret")).toBe(true);
	});

	it.each([
		["a different secret", "s3cret", "other"],
		["a prefix", "s3cre", "s3cret"],
		["a longer value", "s3cret!", "s3cret"],
		["different case", "S3CRET", "s3cret"],
	])("refuses %s, whatever the length", (_label, given, expected) => {
		expect(constantTimeEqual(given, expected)).toBe(false);
	});
});
