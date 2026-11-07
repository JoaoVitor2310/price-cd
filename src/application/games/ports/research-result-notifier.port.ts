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
 * Avisa quem pediu a pesquisa. `notify` só resolve depois de o aviso estar
 * **guardado** para entrega — a entrega em si (com as novas tentativas) é do
 * adapter, e pode acontecer bem depois.
 *
 * Um aviso por `requestUuid`: avisar de novo o mesmo pedido não muda o que quem
 * pediu já recebeu.
 */
export abstract class ResearchResultNotifier {
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
