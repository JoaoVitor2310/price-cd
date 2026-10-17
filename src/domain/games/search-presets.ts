import {
	DEFAULT_SEARCH_CRITERIA,
	type PopularityTiers,
	type SearchCriteria,
	flatPopularity,
} from "@/domain/games/search-criteria.js";

/**
 * Preset de pesquisa: um conjunto nomeado de critérios para um caso de uso.
 *
 * Existe para ninguém precisar lembrar a combinação exata de parâmetros de cada
 * situação, e para essa combinação morar num lugar só — a página e o Sistema
 * Estoque leem daqui. Valores enviados explicitamente na requisição sobrescrevem o
 * preset campo a campo. Plano completo em `docs/SEARCH_PRESETS.md`.
 */
export const SEARCH_PRESET_NAMES = [
	"default",
	"bundle-research",
	"bundle-sync",
	"lists",
	"suppliers",
] as const;

export type SearchPresetName = (typeof SEARCH_PRESET_NAMES)[number];

const freeze = (criteria: SearchCriteria): SearchCriteria =>
	Object.freeze({ ...criteria, popularity: Object.freeze({ ...criteria.popularity }) });

export const SEARCH_PRESETS: Readonly<Record<SearchPresetName, SearchCriteria>> =
	Object.freeze({
		/** O ponto de partida da página e de quem não escolhe preset. */
		default: freeze(DEFAULT_SEARCH_CRITERIA),

		/**
		 * "Pesquisar Preços" de um bundle no Sistema Estoque. Popularidade 1, não 0:
		 * consulta o SteamCharts e descarta o que não existe lá. Sem piso de preço —
		 * no bundle até o jogo barato conta.
		 */
		"bundle-research": freeze({
			popularity: flatPopularity(1),
			minPrice: 0,
			checkGamivoOffer: false,
		}),

		/**
		 * Sync de bundles de hora em hora: só o preço interessa. Popularidade 0 nos
		 * dois tiers pula o SteamCharts inteiro.
		 */
		"bundle-sync": freeze({
			popularity: flatPopularity(0),
			minPrice: 0,
			checkGamivoOffer: false,
		}),

		/**
		 * Reabastecimento (`POST /api/lists/run`). Igual ao default, inclusive a
		 * Gamivo, que casa com o default do `supplierListRequestSchema`; quem chama
		 * ainda pode desligar.
		 */
		lists: freeze(DEFAULT_SEARCH_CRITERIA),

		/** Descoberta de Fornecedores: igual ao default; a oferta usa o preço da Gamivo. */
		suppliers: freeze(DEFAULT_SEARCH_CRITERIA),
	});

/**
 * O nome de cada preset para pessoas, como aparece na página.
 *
 * Separado de `SEARCH_PRESETS` de propósito: o rótulo não é critério de pesquisa,
 * e dentro do preset ele vazaria para o `SearchCriteria` resolvido. O identificador
 * (`bundle-research`) é o que a API recebe e nunca muda; o rótulo pode mudar à vontade.
 */
export const SEARCH_PRESET_LABELS: Readonly<Record<SearchPresetName, string>> =
	Object.freeze({
		default: "Default",
		"bundle-research": "Bundle Research",
		"bundle-sync": "Bundle Sync",
		lists: "Supplier Restock",
		suppliers: "Supplier Discovery",
	});

/** O que a requisição pode sobrescrever, campo a campo. */
export type SearchCriteriaOverrides = {
	popularity?: Partial<PopularityTiers>;
	minPrice?: number;
	checkGamivoOffer?: boolean;
};

/** Preset + sobrescritas explícitas → critérios completos. Sem preset vale o `default`. */
export const resolveSearchCriteria = (
	preset: SearchPresetName = "default",
	overrides: SearchCriteriaOverrides = {},
): SearchCriteria => {
	const base = SEARCH_PRESETS[preset];
	const defined = <T extends object>(values: T): Partial<T> =>
		Object.fromEntries(
			Object.entries(values).filter(([, value]) => value !== undefined),
		) as Partial<T>;

	return {
		...base,
		...defined({
			minPrice: overrides.minPrice,
			checkGamivoOffer: overrides.checkGamivoOffer,
		}),
		popularity: { ...base.popularity, ...defined(overrides.popularity ?? {}) },
	};
};
