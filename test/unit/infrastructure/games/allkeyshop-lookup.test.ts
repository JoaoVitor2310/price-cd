/**
 * A classificação de cada jogo pelo `AllKeyShopPriceFetcher`: `priced`,
 * `not-found` ou `failed`.
 *
 * É ela que decide o que entra no cache de preço (ADR 0008): `not-found` é
 * gravado por 1h, `failed` nunca. Classificar uma falha transitória como
 * `not-found` esconderia o jogo pelo TTL inteiro — por isso cada ramo do loop tem
 * um caso aqui.
 *
 * Nada abre browser: a navegação (`gotoWithRetry`), o download da página do jogo
 * (`fetchWithRetry`) e o parse do HTML são dublês. O que roda de verdade é a
 * orquestração e as regras de região, Edição e oferta.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SharedBrowserSession } from "@/infrastructure/browser/shared-browser-session.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import type {
	GameData,
	Price,
} from "@/infrastructure/games/allkeyshop.types.js";

vi.mock("@/lib/puppeteer-goto-with-retry.js", () => ({
	gotoWithRetry: vi.fn(),
}));
vi.mock("@/lib/fetch-with-retry.js", () => ({
	fetchWithRetry: vi.fn(),
}));
vi.mock("@/infrastructure/games/allkeyshop-html-parser.js", () => ({
	scrapSearchResults: vi.fn(),
	scrapGamePage: vi.fn(),
	extractGamivoSlug: vi.fn(),
}));

const { gotoWithRetry } = await import("@/lib/puppeteer-goto-with-retry.js");
const { fetchWithRetry } = await import("@/lib/fetch-with-retry.js");
const { scrapSearchResults, scrapGamePage, extractGamivoSlug } = await import(
	"@/infrastructure/games/allkeyshop-html-parser.js"
);

const NO_RESULTS_HTML =
	"<div>Sorry, there aren't any results matching your search criteria.</div>";

const GAMIVO_MERCHANT_KEY = "218";
const OTHER_MERCHANT_KEY = "1";

const offer = (originalPrice: number, merchant: string): Price => ({
	id: Number(merchant) * 100 + originalPrice,
	originalPrice,
	merchant: Number(merchant),
	edition: "1",
	region: "1",
	price: originalPrice,
	pricePaypal: originalPrice,
	feesPaypal: 0,
	priceCard: originalPrice,
	feesCard: 0,
	dispo: 1,
	account: false,
	activationPlatform: "steam",
});

const merchant = (name: string) => ({
	name,
	logo: "",
	rating: { score: 0, count: 0, maximum: 0 },
	official: false,
	paypal: false,
});

/** A página de um jogo com uma região global, a Edição Standard e as ofertas dadas. */
const gamePage = (
	prices: Price[],
	overrides: Partial<GameData> = {},
): GameData => ({
	prices,
	regions: {
		"1": {
			region_short_description: "",
			filter_name: "STEAM GLOBAL",
			region_name: "",
			region_long_description: "",
		},
	},
	merchants: {
		[GAMIVO_MERCHANT_KEY]: merchant("GAMIVO"),
		[OTHER_MERCHANT_KEY]: merchant("Other"),
	},
	editions: { "1": { name: "Standard" } },
	...overrides,
});

const page = {
	content: vi.fn(),
	waitForSelector: vi.fn(),
};

const session = {
	enqueue: <T>(task: () => Promise<T>) => task(),
	get: vi.fn(),
	invalidate: vi.fn(),
};

const fetcher = () =>
	new AllKeyShopPriceFetcher(session as unknown as SharedBrowserSession);

const lookupOne = async (name: string) =>
	(await fetcher().lookup([name])).get(name);

/** O caminho feliz até a página do jogo; cada teste desvia num ponto. */
const searchFinds = (resultName: string) => {
	vi.mocked(gotoWithRetry).mockResolvedValue(true);
	page.content.mockResolvedValue("<div>results</div>");
	page.waitForSelector.mockResolvedValue(undefined);
	vi.mocked(scrapSearchResults).mockReturnValue([
		{ link: "/game/hades", name: resultName, price: "" },
	]);
	vi.mocked(fetchWithRetry).mockResolvedValue("<html>game page</html>");
};

beforeEach(() => {
	session.get.mockResolvedValue({ page });
	session.invalidate.mockResolvedValue(undefined);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.mocked(extractGamivoSlug).mockReturnValue(null);
});

afterEach(() => {
	vi.resetAllMocks();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("AllKeyShopPriceFetcher.lookup", () => {
	describe("priced", () => {
		it("returns the best price, whether Gamivo has an offer, and the product name", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(
				gamePage([
					offer(4.99, OTHER_MERCHANT_KEY),
					offer(5.2, GAMIVO_MERCHANT_KEY),
				]),
			);

			expect(await lookupOne("Hades")).toEqual({
				status: "priced",
				price: {
					bestPrice: 4.99,
					hasGamivoOffer: true,
					gamivo_id: undefined,
					foundName: "Hades",
				},
			});
		});

		it("still returns the price when there is no Gamivo offer — the Gamivo cut is the preset's", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(
				gamePage([offer(4.99, OTHER_MERCHANT_KEY)]),
			);

			expect(await lookupOne("Hades")).toMatchObject({
				status: "priced",
				price: { bestPrice: 4.99, hasGamivoOffer: false },
			});
		});

		it("resolves the gamivo_id through the slug when Gamivo has an offer", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(
				gamePage([offer(5.2, GAMIVO_MERCHANT_KEY)]),
			);
			vi.mocked(extractGamivoSlug).mockReturnValue("hades-slug");
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => new Response(JSON.stringify({ id: 4242 }))),
			);

			expect(await lookupOne("Hades")).toMatchObject({
				status: "priced",
				price: { gamivo_id: "4242" },
			});
		});
	});

	describe("not-found — the catalog answered that it does not have it (cacheable)", () => {
		it("when the search page says there are no results", async () => {
			vi.mocked(gotoWithRetry).mockResolvedValue(true);
			page.content.mockResolvedValue(NO_RESULTS_HTML);

			expect(await lookupOne("Nonexistent")).toEqual({ status: "not-found" });
		});

		it("when no search result matches the name", async () => {
			searchFinds("Something Else Entirely");

			expect(await lookupOne("Hades")).toEqual({ status: "not-found" });
		});

		it("when the game page has no offers in the requested region", async () => {
			searchFinds("Hades EU");
			vi.mocked(scrapGamePage).mockReturnValue(
				gamePage([offer(4.99, OTHER_MERCHANT_KEY)]),
			);

			expect(await lookupOne("Hades EU")).toEqual({ status: "not-found" });
		});

		it("when the game page does not have the requested edition", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(
				gamePage([offer(4.99, OTHER_MERCHANT_KEY)], {
					editions: { "1": { name: "Deluxe" } },
				}),
			);

			expect(await lookupOne("Hades")).toEqual({ status: "not-found" });
		});

		it("when the region and edition exist but nobody sells them", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(gamePage([]));

			expect(await lookupOne("Hades")).toEqual({ status: "not-found" });
		});
	});

	describe("failed — we could not ask (never cached)", () => {
		it("when the search page could not be loaded", async () => {
			vi.mocked(gotoWithRetry).mockResolvedValue(false);

			expect(await lookupOne("Hades")).toEqual({ status: "failed" });
		});

		it("when the search results never rendered", async () => {
			vi.mocked(gotoWithRetry).mockResolvedValue(true);
			page.content.mockResolvedValue("<div>loading</div>");
			page.waitForSelector.mockRejectedValue(new Error("TimeoutError"));

			expect(await lookupOne("Hades")).toEqual({ status: "failed" });
		});

		it("when the game page could not be downloaded", async () => {
			searchFinds("Hades");
			vi.mocked(fetchWithRetry).mockRejectedValue(new Error("429"));

			expect(await lookupOne("Hades")).toEqual({ status: "failed" });
		});

		it("when the game page HTML is not what the parser expects", async () => {
			searchFinds("Hades");
			vi.mocked(scrapGamePage).mockReturnValue(null);

			expect(await lookupOne("Hades")).toEqual({ status: "failed" });
		});
	});

	it("answers for every name in the batch, each with its own outcome", async () => {
		vi.mocked(gotoWithRetry)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		page.content.mockResolvedValue(NO_RESULTS_HTML);

		const results = await fetcher().lookup(["Gone", "Flaky"]);

		expect([...results]).toEqual([
			["Gone", { status: "not-found" }],
			["Flaky", { status: "failed" }],
		]);
	});

	it("closes the browser session and rethrows on a fatal error, caching nothing", async () => {
		vi.mocked(gotoWithRetry).mockRejectedValue(new Error("browser died"));

		await expect(fetcher().lookup(["Hades"])).rejects.toThrow("browser died");
		expect(session.invalidate).toHaveBeenCalled();
	});
});
