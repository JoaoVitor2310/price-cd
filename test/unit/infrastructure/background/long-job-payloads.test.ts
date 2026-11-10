import { describe, expect, it } from "vitest";
import { parseListsRunJobPayload } from "@/infrastructure/background/lists-run-job-payload.js";
import { parseSupplierDiscoveryJobPayload } from "@/infrastructure/background/supplier-discovery-job-payload.js";

/** O que volta do Redis passou por JSON. */
const roundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

describe("parseListsRunJobPayload", () => {
	const request = { steam_id: "76561198000000001", checkGamivoOffer: false };

	it("accepts what enqueue stores, after a JSON round trip", () => {
		expect(parseListsRunJobPayload(roundTrip(request))).toEqual(request);
	});

	it("keeps fields the schema does not declare", () => {
		const withNewField = { ...request, someFutureField: "kept" };

		expect(parseListsRunJobPayload(roundTrip(withNewField))).toEqual(
			withNewField,
		);
	});

	it.each([
		["no steam_id", { checkGamivoOffer: true }],
		[
			"checkGamivoOffer of the wrong type",
			{ steam_id: "1", checkGamivoOffer: "yes" },
		],
		["something that is not an object", "garbage"],
	])("refuses a payload with %s, with a readable message", (_label, data) => {
		expect(() => parseListsRunJobPayload(data)).toThrow(
			"Invalid lists job payload",
		);
	});
});

describe("parseSupplierDiscoveryJobPayload", () => {
	it("accepts what enqueue stores, after a JSON round trip", () => {
		const request = { requestedAt: "2026-11-07T10:03:00.000Z" };

		expect(parseSupplierDiscoveryJobPayload(roundTrip(request))).toEqual(
			request,
		);
	});

	it("refuses a payload without requestedAt, with a readable message", () => {
		expect(() => parseSupplierDiscoveryJobPayload({})).toThrow(
			"Invalid suppliers job payload",
		);
	});
});
