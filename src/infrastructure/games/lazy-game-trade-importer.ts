import type {
	GameTradeImporter,
	GameTradeInput,
	GameTradeOptions,
} from "@/application/games/ports/game-trade-importer.port.js";

/**
 * Adia a construção do importer real até o primeiro uso.
 *
 * Existe para preservar uma propriedade do app Express: ele **sobe sem o
 * Sistema Estoque configurado** e continua servindo `/api/games/research` em
 * modo demonstração, que não cria Trade nenhuma. Construir o importer no boot
 * derrubava o app inteiro por causa de uma integração que metade das rotas nem
 * usa.
 *
 * `assertConfigured()` reproduz o `assertTradeImporterConfigured()` do Express:
 * o caminho autenticado chama isto **durante a requisição**, antes de
 * enfileirar — depois de enfileirado não há mais ninguém para receber o erro.
 */
export class LazyGameTradeImporter implements GameTradeImporter {
	private instance: GameTradeImporter | undefined;

	constructor(private readonly build: () => GameTradeImporter) {}

	/** Lança se a integração não estiver configurada. Não guarda a instância. */
	assertConfigured(): void {
		this.resolve();
	}

	async import(games: GameTradeInput[], options?: GameTradeOptions): Promise<void> {
		return this.resolve().import(games, options);
	}

	private resolve(): GameTradeImporter {
		if (!this.instance) this.instance = this.build();
		return this.instance;
	}
}
