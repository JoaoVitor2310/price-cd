import { describe, it, expect } from "vitest";
import { worthyByPopularity } from "@/domain/games/worthy-by-popularity.js";

const makeGames = (popularities: number[]) =>
	popularities.map((popularity, i) => ({ id: i, name: `Game ${i}`, popularity }));

describe("worthyByPopularity", () => {
	it("retorna todos os jogos quando minPopularity é 0", () => {
		const games = makeGames([0, 5, 100]);
		expect(worthyByPopularity(games, 0)).toHaveLength(3);
	});

	it("filtra jogos abaixo da popularidade mínima", () => {
		const games = makeGames([10, 50, 200]);
		const result = worthyByPopularity(games, 100);
		expect(result).toHaveLength(1);
		expect(result[0].popularity).toBe(200);
	});

	it("inclui jogo exatamente no limite mínimo", () => {
		const games = makeGames([99, 100, 101]);
		const result = worthyByPopularity(games, 100);
		expect(result).toHaveLength(2);
		expect(result.map((g) => g.popularity)).toEqual([100, 101]);
	});

	it("retorna array vazio quando nenhum jogo atinge o mínimo", () => {
		const games = makeGames([1, 5, 30]);
		expect(worthyByPopularity(games, 1000)).toHaveLength(0);
	});

	it("retorna array vazio para input vazio", () => {
		expect(worthyByPopularity([], 50)).toHaveLength(0);
	});

	it("preserva o tipo genérico — campos extras são mantidos", () => {
		const games = [
			{ id: 0, name: "Game A", popularity: 200, region: "global", GamivoPrice: "4,50" },
		];
		const result = worthyByPopularity(games, 100);
		expect(result[0].region).toBe("global");
		expect(result[0].GamivoPrice).toBe("4,50");
	});

	it("não muta o array original", () => {
		const games = makeGames([10, 50, 200]);
		const original = [...games];
		worthyByPopularity(games, 100);
		expect(games).toEqual(original);
	});
});
