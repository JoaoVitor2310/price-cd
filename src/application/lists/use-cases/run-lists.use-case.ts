import type {
	GameSearcher,
	ListTopicFetcherFactory,
} from "@/application/lists/ports/list-run.ports.js";
import type { GameTradeImporter, GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import {
	type CancellationSignal,
	throwIfCancelled,
} from "@/application/shared/cancellation.js";
import { resolveSearchCriteria } from "@/domain/games/search-presets.js";
import { disposeIfPresent } from "@/lib/dispose.js";
import type { SupplierListRequest } from "@/schemas/list.schema.js";

/** Só dado: as dependências estão no construtor. */
export type RunListsInput = {
	supplierListRequest: SupplierListRequest;
	checkGamivoOffer: boolean;
};

/**
 * Use case: orquestrates domain + ports.
 * 1) Get user lists from Steam Trades.
 * 2) For each list reference, search HTML and classify active/inactive.
 * 3) Inactive → skip. Active → accumulate games from all lists.
 * 4) Call popularity + price pipeline.
 * 5) Push priced games directly to the inventory system via tradeImporter.
 *
 * Com `signal` abortado (o serviço desligando, o pedido já de volta à fila),
 * para antes de abrir a sessão do AllKeyShop e antes de criar a Trade: fechar o
 * browser só transforma os jogos restantes em "sem preço", e a Trade nasceria com
 * a lista pela metade — e de novo, quando o pedido rodasse outra vez.
 */
export class RunListsUseCase {
	constructor(
		private readonly fetcherFactory: ListTopicFetcherFactory,
		private readonly gameSearcher: GameSearcher,
		private readonly tradeImporter: GameTradeImporter,
		/**
		 * Quantas Listas ativas processar por Fornecedor.
		 *
		 * Era `Number(process.env.MAX_ACTIVE_LISTS) || 3` **dentro** deste
		 * arquivo — violação de camada: um use case não conhece `process.env`.
		 * Agora o valor chega pronto, validado no boot pelo schema de ambiente.
		 */
		private readonly maxActiveLists: number,
	) {}

	async execute(
		input: RunListsInput,
		signal?: CancellationSignal,
	): Promise<void> {
		const { supplierListRequest, checkGamivoOffer } = input;
		const { gameSearcher, tradeImporter, maxActiveLists } = this;
		const steam_id = supplierListRequest.steam_id;

		const allGameNames: string[] = [];

		// Uma sessão de browser por execução, descartada no `finally`.
		const fetcher = this.fetcherFactory.create();

		try {
			const userLists = await fetcher.fetchUserLists(steam_id);
			const limitedLists = userLists.slice(0, Math.max(1, maxActiveLists));

			for (const userList of limitedLists) {
				// Cada Lista abre uma página do SteamTrades e pode esperar a
				// Cloudflare: devolvido o job, não abre a próxima.
				throwIfCancelled(signal);
				const list = await fetcher.fetchList(userList.url);

				if (list.status !== "active") continue;

				allGameNames.push(...list.gameNames);
			}
		} finally {
			await disposeIfPresent(fetcher);
		}

		// Antes de pesquisar: com o serviço desligando, abrir a sessão do AllKeyShop
		// agora subiria um Chromium depois do cleanup.
		throwIfCancelled(signal);

		// Os critérios do Reabastecimento são o preset `lists`; só a oferta Gamivo
		// vem da requisição.
		const pricedByCatalog = await gameSearcher.search({
			gameNames: allGameNames,
			criteria: resolveSearchCriteria("lists", { checkGamivoOffer }),
		});

		const pricedGames: GameTradeInput[] = pricedByCatalog
			.filter((g) => g.GamivoPrice != null)
			.map((g) => ({
				name: g.name,
				market_price_euro: g.GamivoPrice as number,
				popularity: g.popularity,
				region: g.region ?? null,
				id_steam: g.id_steam ?? null,
				gamivo_id: g.gamivo_id ?? null,
			}));

		throwIfCancelled(signal);
		if (pricedGames.length > 0) {
			await tradeImporter.import(pricedGames, { supplier_steam_id: steam_id });
		}
	}
}
