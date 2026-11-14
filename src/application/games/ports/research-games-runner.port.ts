import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { CancellationSignal } from "@/application/shared/cancellation.js";
import type { SearchCriteria } from "@/domain/games/search-criteria.js";
import type { OfferCurrency } from "@/domain/suppliers/offer.js";

/** Dados de uma pesquisa de jogos, sem as dependências de infraestrutura. */
export type ResearchGamesRequest = {
	gameNames: string[];
	/** Critérios já resolvidos (preset + sobrescritas da requisição). */
	criteria: SearchCriteria;
	/** Steam ID do Fornecedor, para vincular a Trade criada. */
	supplierSteamId?: string;
	/** Código da Lista de origem no SteamTrades. */
	listCode?: string;
	/** Nome da Trade que será criada no Sistema Estoque. */
	title?: string;
	/**
	 * A Moeda de oferta escolhida pelo Fornecedor. Presente, a Trade nasce **com
	 * oferta**, decidida pelo Sistema Estoque (`POST /api/trades`); ausente, é a
	 * Trade sem oferta de sempre (`/trades/from-price-researcher`).
	 */
	currency?: OfferCurrency;
	/**
	 * Identificador do pedido, gerado por quem pediu. Deduplica o pedido na fila
	 * (o mesmo uuid enfileirado duas vezes roda uma vez) e volta no webhook.
	 */
	requestUuid?: string;
	/** Para onde avisar o resultado. Exige `requestUuid` e `currency`. */
	webhookUrl?: string;
};

/**
 * Pesquisa a partir de um tópico do SteamTrades: os jogos saem do `.have`, lido
 * quando o pedido roda. Por isso não tem `gameNames`, e a raspagem pode falhar
 * depois do `202`, como `scrape_failed`.
 */
export type TopicResearchRequest = Omit<ResearchGamesRequest, "gameNames"> & {
	topicUrl: string;
};

/**
 * O que a fila guarda e executa. Separados pela presença de `topicUrl`, e não por
 * um campo de tipo: os jobs já guardados no Redis não têm esse campo.
 */
export type ResearchJobRequest = ResearchGamesRequest | TopicResearchRequest;

/**
 * Como terminou o pedido.
 *
 * - `created`: a Trade existe. `tradeUuid` só vem da Trade **com oferta** — a
 *   rota sem oferta do Estoque não devolve identificador.
 * - `not_created`: nenhum jogo passou nos filtros (o Estoque nem é chamado), ou
 *   o Estoque não viu nada a ofertar.
 */
export type ResearchTradeOutcome =
	| { status: "created"; tradeUuid?: string }
	| { status: "not_created"; reason: "nothing_priced" | "nothing_to_offer" };

/**
 * O progresso de uma tentativa, para a próxima continuar dali em vez de refazer
 * a pesquisa. Dois marcos:
 *
 * - `pricedGames`: o que a pesquisa aprovou, guardado **antes** de chamar o
 *   Estoque. A próxima tentativa chama o Estoque com os mesmos jogos — e, com o
 *   `requestUuid`, recebe a mesma Trade. Pesquisar de novo podia não aprovar
 *   nenhum (o SteamCharts falha por lote) e responder `no_trade` com a Trade
 *   existindo.
 * - `outcome`: o que o Estoque respondeu. A próxima tentativa só refaz o aviso.
 *
 * Guardar **nunca lança**: sem o marco, a próxima tentativa só perde o atalho e
 * pesquisa de novo — o comportamento de antes, não um erro.
 */
export type ResearchCheckpoint = {
	readonly pricedGames?: GameTradeInput[];
	readonly outcome?: ResearchTradeOutcome;
	savePricedGames(games: GameTradeInput[]): Promise<void>;
	saveOutcome(outcome: ResearchTradeOutcome): Promise<void>;
};

/** A quem avisar uma falha. Pode vir vazio: nem todo pedido quer aviso. */
export type ResearchFailureTarget = Pick<
	ResearchGamesRequest,
	"webhookUrl" | "requestUuid"
>;

/**
 * Porta para executar o fluxo completo de pesquisa (popularidade + preço + Criar
 * Trade + aviso a quem pediu). É o que a `ResearchQueue` executa ao consumir um
 * pedido — isola a fila da montagem concreta das dependências.
 *
 * `signal` é a fila avisando que o pedido foi **devolvido** a ela (desligamento
 * do serviço) e vai rodar de novo: `run` para antes de criar a Trade.
 *
 * `reportFailure` é separado de `run` porque só a fila sabe quando um pedido
 * falhou de vez. Ela o chama depois de registrar a falha, inclusive nas que nunca
 * passam por `run`: processo morto repetidas vezes, payload ilegível. Falha do
 * desligamento não chega aqui: o pedido volta para a fila, não falha.
 *
 * `canRetry` é a regra de quando é seguro rodar o pedido de novo depois de uma
 * falha: a fila tenta outra vez só quando ele diz que sim. Fica aqui, e não na
 * fila, porque "repetir não cria outra Trade" é regra de negócio.
 *
 * `checkpoint` é onde a fila guarda o progresso de cada tentativa. Na falha
 * definitiva, ela passa a `reportFailure` o desfecho guardado: se o Estoque já
 * respondeu, quem pediu recebe esse desfecho, não `failed`.
 */
export interface ResearchGamesRunner {
	run(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
		checkpoint?: ResearchCheckpoint,
	): Promise<void>;
	reportFailure(
		target: ResearchFailureTarget,
		error: unknown,
		outcome?: ResearchTradeOutcome,
	): Promise<void>;
	canRetry(request: ResearchJobRequest, error: unknown): boolean;
}
