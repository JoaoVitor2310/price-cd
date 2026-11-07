/**
 * Entidade (ou agregado leve): representa um "tópico de lista" no domínio.
 * Não conhece HTTP nem banco — só o que o negócio precisa saber.
 */
/**
 * `inactive`: a página foi lida e o tópico está fechado. Os jogos do `.have` vêm
 * junto, porque a Lista continua na página: quem decide se servem é o fluxo.
 * `unreadable`: não deu para saber (HTTP de erro, página sem `.have`).
 */
export type ListTopicStatus = "active" | "inactive" | "unreadable";

export class ListTopic {
	constructor(
		public readonly url: string,
		public readonly status: ListTopicStatus,
		public readonly gameNames: string[],
	) {}
}
