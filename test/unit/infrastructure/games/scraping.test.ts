import { describe, it, expect } from "vitest";
import {
	scrapSearchResults,
	scrapGamePage,
} from "@/infrastructure/games/allkeyshop-price-fetcher.js";

// ---------------------------------------------------------------------------
// scrapSearchResults
// ---------------------------------------------------------------------------

const makeSearchHtml = (items: { link: string; name: string; price: string }[]) => `
	<html><body>
		${items
			.map(
				(item) => `
			<a class="absolute" href="${item.link}">link</a>
			<p class="text-md text-white">${item.name}</p>
			<a class="price-skew"><span>${item.price}</span></a>
		`,
			)
			.join("")}
	</body></html>
`;

describe("scrapSearchResults", () => {
	it("retorna resultados corretos a partir do HTML", () => {
		const html = makeSearchHtml([
			{ link: "/game/house-flipper", name: "House Flipper", price: "€4.99" },
		]);
		const results = scrapSearchResults(html);
		expect(results).toHaveLength(1);
		expect(results[0].link).toBe("/game/house-flipper");
		expect(results[0].name).toBe("House Flipper");
	});

	it("substitui € e ponto decimal por vírgula no preço", () => {
		const html = makeSearchHtml([
			{ link: "/game/test", name: "Test Game", price: "€4.99" },
		]);
		const results = scrapSearchResults(html);
		expect(results[0].price).toBe("4,99");
	});

	it("retorna array vazio quando não há resultados no HTML", () => {
		const results = scrapSearchResults("<html><body></body></html>");
		expect(results).toHaveLength(0);
	});

	it("limita pelo menor array quando quantidades diferem", () => {
		// 2 links, 1 nome, 2 preços → mínimo é 1
		const html = `
			<html><body>
				<a class="absolute" href="/game/a">l</a>
				<a class="absolute" href="/game/b">l</a>
				<p class="text-md text-white">Game A</p>
				<a class="price-skew"><span>€3.00</span></a>
				<a class="price-skew"><span>€4.00</span></a>
			</body></html>
		`;
		const results = scrapSearchResults(html);
		expect(results).toHaveLength(1);
	});

	it("retorna múltiplos resultados na ordem correta", () => {
		const html = makeSearchHtml([
			{ link: "/game/a", name: "Game A", price: "€1.00" },
			{ link: "/game/b", name: "Game B", price: "€2.00" },
			{ link: "/game/c", name: "Game C", price: "€3.00" },
		]);
		const results = scrapSearchResults(html);
		expect(results).toHaveLength(3);
		expect(results[1].name).toBe("Game B");
	});
});

// ---------------------------------------------------------------------------
// scrapGamePage
// ---------------------------------------------------------------------------

const makeGamePageHtml = (jsonContent: string) => `
	<html><body>
		<script id="aks-offers-js-extra">
			var gamePageTrans = ${jsonContent};
		</script>
	</body></html>
`;

describe("scrapGamePage", () => {
	it("retorna GameData quando o script está presente e válido", () => {
		const payload = JSON.stringify({
			prices: [],
			regions: {},
			merchants: {},
		});
		const html = makeGamePageHtml(payload);
		const result = scrapGamePage(html);
		expect(result).not.toBeNull();
		expect(result).toHaveProperty("prices");
		expect(result).toHaveProperty("regions");
		expect(result).toHaveProperty("merchants");
	});

	it("retorna null quando o script não existe no HTML", () => {
		const html = "<html><body><p>No script here</p></body></html>";
		expect(scrapGamePage(html)).toBeNull();
	});

	it("retorna null quando o JSON dentro do script é inválido", () => {
		const html = `
			<html><body>
				<script id="aks-offers-js-extra">
					var gamePageTrans = { invalid json ;
				</script>
			</body></html>
		`;
		expect(scrapGamePage(html)).toBeNull();
	});

	it("retorna null quando o padrão gamePageTrans não está presente no script", () => {
		const html = `
			<html><body>
				<script id="aks-offers-js-extra">
					var otherVar = {};
				</script>
			</body></html>
		`;
		expect(scrapGamePage(html)).toBeNull();
	});

	it("parseia corretamente preços e merchants aninhados", () => {
		const payload = JSON.stringify({
			prices: [{ id: 1, originalPrice: 4.99 }],
			regions: { "1": { filter_name: "STEAM GLOBAL" } },
			merchants: { "1": { name: "GAMIVO" } },
		});
		const html = makeGamePageHtml(payload);
		const result = scrapGamePage(html);
		expect(result?.prices[0].originalPrice).toBe(4.99);
		expect(result?.merchants["1"].name).toBe("GAMIVO");
	});
});
