import { MIN_PRICE_EURO } from "@/domain/games/worthy-by-price.js";

/**
 * Popularidade mínima (pico de jogadores em 24h) que um jogo precisa ter, por faixa
 * de preço. Jogo barato rende pouco por key, então basta pouca procura para valer a
 * pena; jogo caro só compensa se tiver procura de verdade.
 *
 * Popularidade plana é o mesmo valor nos dois tiers.
 */
export type PopularityTiers = {
	/** Mínimo para jogo com preço ATÉ o limite, inclusive (€5,00 cai aqui). */
	upToThreshold: number;
	/** Mínimo para jogo com preço ACIMA do limite. */
	aboveThreshold: number;
	/** O limite de preço, em euro, que separa os dois tiers. */
	priceThresholdEuro: number;
};

/** Tudo que decide se um jogo pesquisado volta no resultado. */
export type SearchCriteria = {
	popularity: PopularityTiers;
	/** Preço mínimo negociável: o preço precisa ser MAIOR que este valor. */
	minPrice: number;
	/** Só aceita jogos que tenham oferta na Gamivo. */
	checkGamivoOffer: boolean;
};

export const DEFAULT_PRICE_THRESHOLD_EURO = 5;

/**
 * 30 até €5 é o corte plano que valia para tudo antes dos tiers: o tier de baixo
 * mantém o nível de antes (e o mesmo volume de jogos indo ao AllKeyShop), e só o
 * jogo caro passa a exigir mais procura.
 */
export const DEFAULT_POPULARITY_TIERS: PopularityTiers = Object.freeze({
	upToThreshold: 30,
	aboveThreshold: 100,
	priceThresholdEuro: DEFAULT_PRICE_THRESHOLD_EURO,
});

/** Mesmo mínimo nos dois tiers — a regra antiga, de popularidade única. */
export const flatPopularity = (minPopularity: number): PopularityTiers => ({
	upToThreshold: minPopularity,
	aboveThreshold: minPopularity,
	priceThresholdEuro: DEFAULT_PRICE_THRESHOLD_EURO,
});

/**
 * O corte que dá para fazer ANTES de conhecer o preço: o menor dos dois tiers.
 *
 * É o que mantém o AllKeyShop (a etapa cara, sequencial, num navegador) longe de
 * jogos que não passariam em tier nenhum. O tier exato só se aplica depois do preço.
 */
export const lowestTier = (tiers: PopularityTiers): number =>
	Math.min(tiers.upToThreshold, tiers.aboveThreshold);

/**
 * Popularidade 0 nos DOIS tiers dispensa o SteamCharts inteiro: ninguém é cortado
 * por popularidade, então não há o que consultar. Basta um tier acima de 0 para a
 * consulta ser necessária — e então jogo não encontrado no SteamCharts sai do
 * resultado, como sempre aconteceu com popularidade 1 ou mais.
 */
export const needsPopularityLookup = (tiers: PopularityTiers): boolean =>
	tiers.upToThreshold > 0 || tiers.aboveThreshold > 0;

/** Qual dos dois tiers vale para um preço, e o mínimo dele. */
export type ApplicableTier = {
	side: "upToThreshold" | "aboveThreshold";
	minimum: number;
};

/**
 * O único lugar que decide de que lado do limite um preço fica. Quem precisa
 * explicar a escolha (o log de descarte) pergunta aqui em vez de refazer a
 * comparação — senão uma mudança na fronteira deixaria a explicação errada.
 */
export const tierFor = (tiers: PopularityTiers, price: number): ApplicableTier =>
	price <= tiers.priceThresholdEuro
		? { side: "upToThreshold", minimum: tiers.upToThreshold }
		: { side: "aboveThreshold", minimum: tiers.aboveThreshold };

/** O mínimo que vale para um jogo com este preço. */
export const requiredPopularity = (
	tiers: PopularityTiers,
	price: number,
): number => tierFor(tiers, price).minimum;

type Rated = { popularity: number; GamivoPrice?: number };

export type PopularityTierPartition<T> = { worthy: T[]; tooUnpopular: T[] };

/**
 * Aplica o tier exato, agora que o preço é conhecido. Separa em vez de só filtrar,
 * pelo mesmo motivo de `partitionByPrice`: quem descarta precisa dizer o que descartou.
 *
 * Jogo sem preço não deveria chegar aqui (o piso de preço já o descartou); se chegar,
 * é tratado como €0, ou seja, pelo tier de baixo.
 */
export const partitionByPopularityTier = <T extends Rated>(
	games: T[],
	tiers: PopularityTiers,
): PopularityTierPartition<T> => {
	const worthy: T[] = [];
	const tooUnpopular: T[] = [];

	for (const game of games) {
		const required = requiredPopularity(tiers, game.GamivoPrice ?? 0);
		if (game.popularity >= required) worthy.push(game);
		else tooUnpopular.push(game);
	}

	return { worthy, tooUnpopular };
};

/**
 * Exige oferta na Gamivo por padrão: é onde o CarcaDeals revende, então jogo sem
 * oferta lá é jogo que não temos como vender. Os presets de bundle desligam porque
 * querem o preço de todo jogo do bundle.
 */
export const DEFAULT_SEARCH_CRITERIA: SearchCriteria = Object.freeze({
	popularity: DEFAULT_POPULARITY_TIERS,
	minPrice: MIN_PRICE_EURO,
	checkGamivoOffer: true,
});
