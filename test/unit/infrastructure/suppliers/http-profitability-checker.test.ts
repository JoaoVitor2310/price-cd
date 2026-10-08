import { afterEach, describe, expect, it, vi } from "vitest";
import {
	HttpProfitabilityChecker,
	toProspectResult,
	type ProspectWire,
} from "@/infrastructure/suppliers/http-profitability-checker.js";

function makeWire(overrides: Partial<ProspectWire> = {}): ProspectWire {
	return {
		profitable: [
			{ name: "Half-Life", market_price_euro: 1.5, popularity: 100, region: null, tf2_price: 0.5 },
			{ name: "Portal", market_price_euro: 3, popularity: 200, region: null, tf2_price: 1 },
		],
		total_tf2_price: 1.5,
		is_added: false,
		should_comment: true,
		last_commented_at: null,
		games_changed: false,
		...overrides,
	};
}

/** Uma resposta em que o Sistema Estoque calculou a oferta na moeda pedida. */
function makeMoneyWire(currency: "eur" | "usd", overrides: Partial<ProspectWire> = {}): ProspectWire {
	const wire = makeWire();
	return {
		...wire,
		offer_currency: currency,
		total_offer_price: 4.2,
		profitable: [
			{ ...wire.profitable[0], offer_price: 1.2 },
			{ ...wire.profitable[1], offer_price: 3 },
		],
		...overrides,
	};
}

describe("toProspectResult", () => {
	describe("in TF2 keys", () => {
		it("builds the offer from tf2_price and total_tf2_price", () => {
			const { offer } = toProspectResult(makeWire(), "tf2");

			expect(offer).toEqual({
				currency: "tf2",
				lines: [
					{ name: "Half-Life", amount: 0.5 },
					{ name: "Portal", amount: 1 },
				],
				total: 1.5,
			});
		});

		it("does not need the new offer fields, so an older Sistema Estoque keeps working", () => {
			expect(() => toProspectResult(makeWire(), "tf2")).not.toThrow();
		});

		it("ignores offer fields the Sistema Estoque sent anyway", () => {
			const { offer } = toProspectResult(makeMoneyWire("eur"), "tf2");

			expect(offer.total).toBe(1.5);
		});
	});

	describe.each(["eur", "usd"] as const)("in %s", (currency) => {
		it("builds the offer from offer_price and total_offer_price", () => {
			const { offer } = toProspectResult(makeMoneyWire(currency), currency);

			expect(offer).toEqual({
				currency,
				lines: [
					{ name: "Half-Life", amount: 1.2 },
					{ name: "Portal", amount: 3 },
				],
				total: 4.2,
			});
		});

		it("throws when the Sistema Estoque did not report the offer currency", () => {
			const wire = makeMoneyWire(currency, { offer_currency: undefined });

			expect(() => toProspectResult(wire, currency)).toThrow(/did not return an offer/);
		});

		it("throws when the Sistema Estoque answered in a different currency", () => {
			const other = currency === "eur" ? "usd" : "eur";

			expect(() => toProspectResult(makeMoneyWire(other), currency)).toThrow(/did not return an offer/);
		});

		it("throws when it answered only in TF2 keys, as an older Sistema Estoque would", () => {
			expect(() => toProspectResult(makeWire(), currency)).toThrow(/did not return an offer/);
		});

		it("throws when the total is missing", () => {
			const wire = makeMoneyWire(currency, { total_offer_price: undefined });

			expect(() => toProspectResult(wire, currency)).toThrow(/did not return an offer/);
		});

		it("throws when a game has no offer_price", () => {
			const wire = makeMoneyWire(currency);
			wire.profitable[1] = { ...wire.profitable[1], offer_price: undefined };

			expect(() => toProspectResult(wire, currency)).toThrow(/did not return an offer/);
		});

		it("throws when an amount is not a finite number", () => {
			const wire = makeMoneyWire(currency, { total_offer_price: Number.NaN });

			expect(() => toProspectResult(wire, currency)).toThrow(/did not return an offer/);
		});

		it("does not throw when the Sistema Estoque decided not to comment", () => {
			// O caso mais comum: nada será postado, então a oferta ausente não pode virar erro.
			const wire = makeWire({ should_comment: false, profitable: [] });

			expect(() => toProspectResult(wire, currency)).not.toThrow();
		});
	});

	describe("when the Sistema Estoque decided not to comment", () => {
		it.each(["tf2", "eur", "usd"] as const)("has no offer in %s", (currency) => {
			const wire = makeWire({ should_comment: false, profitable: [] });

			expect(toProspectResult(wire, currency).offer).toBeNull();
		});

		it("has no offer even when it still sent the money fields", () => {
			// O Sistema Estoque também devolve os campos de oferta sem comentário, se há cotação.
			const wire = makeMoneyWire("eur", { should_comment: false });

			expect(toProspectResult(wire, "eur").offer).toBeNull();
		});

		it("has no offer in TF2 even though there are games to list", () => {
			const wire = makeWire({ should_comment: false });

			expect(toProspectResult(wire, "tf2").offer).toBeNull();
		});
	});

	it("keeps the other fields of the Sistema Estoque answer", () => {
		const result = toProspectResult(
			makeMoneyWire("eur", { is_added: true, last_commented_at: "2026-10-01T00:00:00Z", games_changed: true }),
			"eur",
		);

		expect(result).toMatchObject({
			is_added: true,
			should_comment: true,
			last_commented_at: "2026-10-01T00:00:00Z",
			games_changed: true,
			total_tf2_price: 1.5,
		});
	});

	it("does not leak the wire-only offer fields into the profitable games", () => {
		const { profitable } = toProspectResult(makeMoneyWire("usd"), "usd");

		expect(profitable[0]).not.toHaveProperty("offer_price");
		expect(profitable[0]).toMatchObject({ name: "Half-Life", tf2_price: 0.5 });
	});
});

describe("HttpProfitabilityChecker.evaluate", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	const supplier = { steam_id: "76561198000000000", list_code: "ABC12" };
	const games = [{ name: "Half-Life", market_price_euro: 1.5, popularity: 100, region: null, gamivo_id: null }];

	function stubFetch(body: unknown, ok = true) {
		const fetchMock = vi.fn().mockResolvedValue({
			ok,
			status: ok ? 200 : 500,
			headers: new Headers({ "content-type": "application/json" }),
			text: async () => (ok ? JSON.stringify(body) : "boom"),
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	/** Uma resposta arbitrária, para simular o que um proxy ou framework devolve fora do contrato. */
	function stubRawResponse(init: { status: number; contentType?: string; location?: string; body: string }) {
		const headers = new Headers();
		if (init.contentType) headers.set("content-type", init.contentType);
		if (init.location) headers.set("location", init.location);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: init.status >= 200 && init.status < 300,
			status: init.status,
			headers,
			text: async () => init.body,
		});
		vi.stubGlobal("fetch", fetchMock);
		return fetchMock;
	}

	it("asks the Sistema Estoque for the offer in the requested currency", async () => {
		const fetchMock = stubFetch(makeMoneyWire("eur"));

		await new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "eur");

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe("http://estoque/suppliers/prospect");
		expect(JSON.parse(init.body)).toEqual({
			supplier_steam_id: "76561198000000000",
			list_code: "ABC12",
			offer_currency: "eur",
			games,
		});
	});

	it("sends each game's market price to the Sistema Estoque as market_price_euro", async () => {
		const fetchMock = stubFetch(makeWire());

		await new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2");

		const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(sent.games[0]).toHaveProperty("market_price_euro", 1.5);
		expect(sent.games[0]).not.toHaveProperty("price_euro");
	});

	it("reads market_price_euro from the profitable games it gets back", async () => {
		stubFetch(makeWire());

		const result = await new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2");

		expect(result.profitable[0].market_price_euro).toBe(1.5);
	});

	it("returns the offer in the requested currency", async () => {
		stubFetch(makeMoneyWire("usd"));

		const result = await new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "usd");

		expect(result.offer?.currency).toBe("usd");
		expect(result.offer?.total).toBe(4.2);
	});

	it("rejects when the Sistema Estoque ignores the requested money currency", async () => {
		stubFetch(makeWire());

		await expect(
			new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "eur"),
		).rejects.toThrow(/did not return an offer/);
	});

	it("rejects on a non-2xx response", async () => {
		stubFetch({}, false);
		vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2"),
		).rejects.toThrow(/failed with status 500/);
	});

	it("asks for JSON and refuses to follow redirects", async () => {
		const fetchMock = stubFetch(makeWire());

		await new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2");

		const [, init] = fetchMock.mock.calls[0];
		expect(init.headers.Accept).toBe("application/json");
		expect(init.redirect).toBe("manual");
	});

	it("reports a redirect as an error that names where it pointed", async () => {
		// O caso que escondia a causa: rejeição virando redirect para uma página HTML.
		stubRawResponse({ status: 302, location: "https://estoque/login", body: "" });
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(
			new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2"),
		).rejects.toThrow(/failed with status 302/);
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("https://estoque/login"));
	});

	it("explains a 2xx HTML body instead of failing with an opaque JSON syntax error", async () => {
		stubRawResponse({ status: 200, contentType: "text/html; charset=UTF-8", body: "<!DOCTYPE html><html>login</html>" });
		vi.spyOn(console, "error").mockImplementation(() => {});

		const promise = new HttpProfitabilityChecker("http://estoque", "token").evaluate(supplier, games, "tf2");

		await expect(promise).rejects.toThrow(/non-JSON body \(HTTP 200, content-type text\/html; charset=UTF-8\): <!DOCTYPE html>/);
	});

	it("truncates a huge non-JSON body in the error message", async () => {
		stubRawResponse({ status: 200, contentType: "text/html", body: `<html>${"x".repeat(5000)}` });
		vi.spyOn(console, "error").mockImplementation(() => {});

		const error = await new HttpProfitabilityChecker("http://estoque", "token")
			.evaluate(supplier, games, "tf2")
			.catch((e: Error) => e);

		expect((error as Error).message.length).toBeLessThan(400);
	});
});
