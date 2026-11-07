import type { ListTopic } from "@/domain/lists/list-topic.js";
import { parseSteamTradesTopicUrl } from "@/domain/lists/topic-url.js";
import type { ListTopicFetcherFactory } from "@/application/lists/ports/list-run.ports.js";
import { disposeIfPresent } from "@/lib/dispose.js";

/**
 * Não deu para ler o tópico: navegador, Cloudflare, HTTP de erro ou página sem
 * `.have`. O motivo vai na mensagem, que é o que fica no registro do job; quem
 * pediu recebe só o tipo (`scrape_failed`), com a frase fixa.
 */
export class TopicScrapeFailedError extends Error {
	constructor(
		topicUrl: string,
		public readonly cause?: unknown,
	) {
		const reason = cause instanceof Error ? `: ${cause.message}` : "";
		super(`Could not read the SteamTrades topic ${topicUrl}${reason}`);
		this.name = "TopicScrapeFailedError";
	}
}

/**
 * Lê os jogos do `.have` de um tópico, **todos**: é um tópico só, então o teto do
 * Reabastecimento (`MAX_ACTIVE_LISTS`) não se aplica.
 *
 * Tópico inativo é pesquisado do mesmo jeito: foi o próprio Fornecedor que mandou
 * o link, então a Lista vale mesmo fechada. Diferente do Reabastecimento, que parte
 * do Fornecedor e pula o que ele fechou.
 *
 * O link é conferido de novo aqui, e não só na requisição: é o navegador que vai
 * abri-lo, e o pedido pode ter vindo de outra versão do código, pela fila.
 *
 * O navegador é aberto por leitura e fechado antes de a pesquisa de preço começar,
 * para não ficar de pé durante os minutos do AllKeyShop.
 */
export class ReadTopicGames {
	constructor(private readonly fetcherFactory: ListTopicFetcherFactory) {}

	async run(topicUrl: string): Promise<string[]> {
		const ref = parseSteamTradesTopicUrl(topicUrl);
		if (ref === null) throw new TopicScrapeFailedError(topicUrl);

		const fetcher = this.fetcherFactory.create();

		let topic: ListTopic;
		try {
			topic = await fetcher.fetchList(ref.url);
		} catch (error) {
			throw new TopicScrapeFailedError(topicUrl, error);
		} finally {
			await disposeIfPresent(fetcher);
		}

		if (topic.status === "unreadable") {
			throw new TopicScrapeFailedError(topicUrl);
		}
		return topic.gameNames;
	}
}
