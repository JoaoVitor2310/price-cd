/**
 * Por que um pedido de pesquisa não terminou.
 *
 * - `scrape_failed`: não deu para ler o tópico do SteamTrades. Só na pesquisa a
 *   partir do link; repetir mais tarde pode resolver.
 * - `pricing_failed`: a pesquisa em si falhou (navegador, Cloudflare, pipeline),
 *   o Sistema Estoque recusou o pedido como inválido, ou confirmou a Trade numa
 *   resposta ilegível. Repetir sem olhar o que houve não é seguro.
 * - `stock_unavailable`: o Sistema Estoque não respondeu como deveria (fora do
 *   ar, timeout, sem cotação da TF2 Key). Repetir mais tarde pode resolver.
 */
export type ResearchFailureKind =
	| "scrape_failed"
	| "pricing_failed"
	| "stock_unavailable";

/**
 * O Resultado da pesquisa: o que quem pediu fica sabendo ao final. Nunca carrega
 * preço de mercado, popularidade nem margem — só o desfecho.
 */
export type ResearchResult =
	| { result: "trade_created"; tradeUuid: string }
	| { result: "no_trade" }
	| {
			result: "failed";
			failure: { kind: ResearchFailureKind; message: string };
	  };

export type ResearchResultTarget = {
	webhookUrl: string;
	requestUuid: string;
};

/**
 * Não deu para **guardar** o aviso para entrega: o armazenamento da fila de
 * avisos não respondeu, mesmo depois das tentativas do adapter. Passageiro — e
 * o único erro de `notify` que vale tentar de novo: um aviso que não se consegue
 * montar falharia igual.
 *
 * A causa vai na mensagem: o target do build (ES6) não tem `Error.cause`.
 */
export class ResultStoreUnavailableError extends Error {
	constructor(reason: string) {
		super(`The research result could not be stored for delivery: ${reason}`);
		this.name = "ResultStoreUnavailableError";
	}
}

/**
 * Avisa quem pediu a pesquisa. `notify` só resolve depois de o aviso estar
 * **guardado** para entrega — a entrega em si (com as novas tentativas) é do
 * adapter, e pode acontecer bem depois.
 *
 * Um aviso por `requestUuid`: avisar de novo o mesmo pedido não muda o que quem
 * pediu já recebeu.
 */
export abstract class ResearchResultNotifier {
	/** @throws ResultStoreUnavailableError quando não consegue guardar o aviso */
	abstract notify(
		target: ResearchResultTarget,
		result: ResearchResult,
	): Promise<void>;
	/**
	 * Entrega de novo o resultado já guardado para este pedido, com as novas
	 * tentativas zeradas. `false` se não há resultado guardado (o registro
	 * expirou, ou o pedido nunca teve webhook).
	 */
	abstract redeliver(requestUuid: string): Promise<boolean>;
	/**
	 * Apaga o resultado guardado, para um novo resultado poder ser avisado. Lança
	 * se não conseguir (uma entrega em andamento, por exemplo): rodar de novo com
	 * o resultado antigo guardado faria o novo ser ignorado.
	 */
	abstract forget(requestUuid: string): Promise<void>;
}
