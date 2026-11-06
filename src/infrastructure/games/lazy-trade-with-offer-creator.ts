import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import {
	StockUnavailableError,
	type TradeWithOfferCreator,
	type TradeWithOfferOptions,
	type TradeWithOfferOutcome,
} from "@/application/games/ports/trade-with-offer-creator.port.js";

/**
 * Adia a construção do adapter real até o primeiro uso, pelo mesmo motivo do
 * `LazyGameTradeImporter`: o app sobe sem o Sistema Estoque configurado e serve
 * o modo demo.
 *
 * O caminho autenticado já confere a configuração antes de enfileirar
 * (`LazyGameTradeImporter.assertConfigured`, mesmas variáveis). Se ela sumir
 * entre o pedido e a execução — o job sobrevive a deploys —, a falha sai como
 * `StockUnavailableError`, que é o que ela é para quem pediu.
 */
export class LazyTradeWithOfferCreator implements TradeWithOfferCreator {
	private instance: TradeWithOfferCreator | undefined;

	constructor(private readonly build: () => TradeWithOfferCreator) {}

	async create(
		games: GameTradeInput[],
		options: TradeWithOfferOptions,
	): Promise<TradeWithOfferOutcome> {
		if (!this.instance) {
			try {
				this.instance = this.build();
			} catch (error) {
				throw new StockUnavailableError(
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		return this.instance.create(games, options);
	}
}
