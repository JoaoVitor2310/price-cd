import type {
	GameTradeImporter,
	GameTradeInput,
} from "@/application/games/ports/game-trade-importer.port.js";

/**
 * Importer que não faz nada — o null object do modo demonstração.
 *
 * O modo demo nunca chega a importar (o use case retorna antes), mas o
 * construtor exige a dependência. Passar o importer real ali faria o demo
 * **exigir configuração do Sistema Estoque** para rodar, que é o oposto do que
 * ele serve: mostrar preços sem integração nenhuma.
 *
 * Se um dia o demo chamar `import()` por engano, isto silencia em vez de
 * estourar — por isso ele loga. Não é caminho esperado.
 */
export class NoopGameTradeImporter implements GameTradeImporter {
	async import(games: GameTradeInput[]): Promise<void> {
		console.warn(
			`⚠️ [DEMO] import() chamado em modo demonstração com ${games.length} jogo(s) — ignorado.`,
		);
	}
}
