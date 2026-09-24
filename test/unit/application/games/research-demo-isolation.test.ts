import { describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/games/steam-charts-popularity-fetcher.js", () => ({
	SteamChartsPopularityFetcher: vi.fn(() => ({ fetch: async () => [] })),
}));
vi.mock("@/infrastructure/games/allkeyshop-price-fetcher.js", () => ({
	AllKeyShopPriceFetcher: vi.fn(() => ({ fetch: async () => [] })),
}));

describe("demo mode isolation", () => {
	it("runs without any inventory system configuration", async () => {
		// O demo existe para mostrar preços sem integração. Se ele passar a
		// exigir SISTEMA_ESTOQUE_URL, a rota pública quebra em qualquer ambiente
		// que não tenha o Sistema Estoque — e nenhum caso de contrato pega isso,
		// porque a bateria configura as variáveis.
		delete process.env.SISTEMA_ESTOQUE_URL;
		delete process.env.EXTERNAL_SECRET;

		const { researchGamesDemoService } = await import(
			"@/services/games/research-games.service.js"
		);

		await expect(
			researchGamesDemoService({
				gameNames: ["Hades"],
				minPopularity: 0,
				checkGamivoOffer: false,
			}),
		).resolves.toEqual([]);
	});
});
