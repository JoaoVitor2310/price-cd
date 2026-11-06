import { afterEach, describe, expect, it, vi } from "vitest";
import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import {
	StockUnavailableError,
	TradeOutcomeUnknownError,
	TradeRejectedError,
} from "@/application/games/ports/trade-with-offer-creator.port.js";
import { HttpTradeWithOfferCreator } from "@/infrastructure/games/http-trade-with-offer-creator.js";
import { LazyTradeWithOfferCreator } from "@/infrastructure/games/lazy-trade-with-offer-creator.js";

const games: GameTradeInput[] = [
	{
		name: "Taiji",
		market_price_euro: 1.23,
		popularity: 542,
		region: "",
		id_steam: "70",
		gamivo_id: "12345",
	},
];

const options = {
	supplierSteamId: "76561198012345678",
	currency: "eur" as const,
	listCode: "AbC12",
};

function stubFetch(status: number, body: unknown) {
	const fetchMock = vi.fn(
		async () =>
			new Response(typeof body === "string" ? body : JSON.stringify(body), {
				status,
			}),
	);
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

const creator = () =>
	new HttpTradeWithOfferCreator("http://estoque.internal", "external-secret");

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("HttpTradeWithOfferCreator", () => {
	it("posts the contract of POST /api/trades", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const fetchMock = stubFetch(201, {
			uuid: "3a9e",
			created_at: "2026-11-04T10:00:00-03:00",
			currency: "eur",
		});

		await creator().create(games, { ...options, title: "From the chat" });

		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("http://estoque.internal/api/trades");
		expect(init.method).toBe("POST");
		expect(init.redirect).toBe("manual");
		expect(init.headers).toMatchObject({
			Authorization: "Bearer external-secret",
			Accept: "application/json",
		});
		expect(JSON.parse(init.body as string)).toEqual({
			supplier_steam_id: "76561198012345678",
			currency: "eur",
			list_code: "AbC12",
			title: "From the chat",
			// Sem `id_steam`: não faz parte do contrato da rota.
			games: [
				{
					name: "Taiji",
					market_price_euro: 1.23,
					popularity: 542,
					region: "",
					gamivo_id: "12345",
				},
			],
		});
	});

	it("leaves out the optional fields it does not have", async () => {
		const fetchMock = stubFetch(201, { uuid: "3a9e", currency: "tf2" });

		await creator().create(games, {
			supplierSteamId: "76561198012345678",
			currency: "tf2",
		});

		const body = JSON.parse(
			(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
				.body as string,
		);
		expect(body).not.toHaveProperty("list_code");
		expect(body).not.toHaveProperty("title");
	});

	it("201: created, whatever else the body says, since the Trade already exists", async () => {
		stubFetch(201, { uuid: "3a9e", created_at: "x", currency: "brl" });

		await expect(creator().create(games, options)).resolves.toEqual({
			status: "created",
			tradeUuid: "3a9e",
		});
	});

	it("201 without a readable uuid: not an error that invites a retry", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		stubFetch(201, { created_at: "x" });

		await expect(creator().create(games, options)).rejects.toBeInstanceOf(
			TradeOutcomeUnknownError,
		);
	});

	it("200 { created: false }: not created, and not an error", async () => {
		stubFetch(200, { created: false });

		await expect(creator().create(games, options)).resolves.toEqual({
			status: "not_created",
		});
	});

	describe("failures", () => {
		it("422: TradeRejectedError", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			stubFetch(422, {
				message: "The supplier steam id field format is invalid.",
			});

			await expect(creator().create(games, options)).rejects.toBeInstanceOf(
				TradeRejectedError,
			);
		});

		it.each([
			[503, { message: "TF2 price in EUR unavailable" }],
			[500, "Server Error"],
			[401, { message: "Unauthenticated." }],
			[302, ""],
		])("%i: StockUnavailableError", async (status, body) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			stubFetch(status, body);

			const error = await creator()
				.create(games, options)
				.catch((e) => e);
			expect(error).toBeInstanceOf(StockUnavailableError);
			expect(error.message).toBe(`Sistema Estoque answered HTTP ${status}`);
		});

		it("an unexpected 200 is not read as 'nothing to offer'", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			stubFetch(200, "<html>login</html>");

			await expect(creator().create(games, options)).rejects.toBeInstanceOf(
				StockUnavailableError,
			);
		});

		it("a network failure is a StockUnavailableError, without the internal URL in the message", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			vi.stubGlobal(
				"fetch",
				vi.fn().mockRejectedValue(new TypeError("fetch failed")),
			);

			const error = await creator()
				.create(games, options)
				.catch((e) => e);
			expect(error).toBeInstanceOf(StockUnavailableError);
			expect(error.message).toBe("Sistema Estoque could not be reached");
			expect(error.message).not.toContain("estoque.internal");
		});

		it("a timeout is a StockUnavailableError", async () => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const timeout = new DOMException(
				"The operation was aborted due to timeout",
				"TimeoutError",
			);
			vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

			await expect(creator().create(games, options)).rejects.toThrow(
				"Sistema Estoque did not answer within 15s",
			);
		});
	});
});

describe("LazyTradeWithOfferCreator", () => {
	it("builds the adapter on first use only", async () => {
		const create = vi.fn().mockResolvedValue({ status: "not_created" });
		const build = vi.fn(() => ({ create }));
		const lazy = new LazyTradeWithOfferCreator(build);

		expect(build).not.toHaveBeenCalled();
		await lazy.create(games, options);
		await lazy.create(games, options);

		expect(build).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledTimes(2);
	});

	it("turns missing configuration into StockUnavailableError", async () => {
		const lazy = new LazyTradeWithOfferCreator(() => {
			throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");
		});

		const error = await lazy.create(games, options).catch((e) => e);
		expect(error).toBeInstanceOf(StockUnavailableError);
		expect(error.message).toBe("SISTEMA_ESTOQUE_URL is not defined in .env");
	});
});
