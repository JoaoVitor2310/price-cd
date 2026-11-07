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
 * Se quem executa pediu para parar. Só a forma que a Application precisa: o
 * `AbortSignal` da plataforma a satisfaz, sem a Application depender dele.
 */
export type CancellationSignal = { readonly aborted: boolean };

/**
 * Porta para executar o fluxo completo de pesquisa (popularidade + preço + Criar
 * Trade + aviso a quem pediu). É o que a `ResearchQueue` executa ao consumir um
 * pedido — isola a fila da montagem concreta das dependências.
 *
 * `signal` é a fila avisando que o pedido foi **devolvido** a ela (desligamento
 * do serviço) e vai rodar de novo. Uma falha depois disso é do desligamento, não
 * do pedido: não pode virar um resultado `failed` para quem pediu.
 */
export interface ResearchGamesRunner {
	run(
		request: ResearchJobRequest,
		signal?: CancellationSignal,
	): Promise<void>;
}
