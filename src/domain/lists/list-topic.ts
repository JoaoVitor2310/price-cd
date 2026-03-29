/**
 * Entidade (ou agregado leve): representa um "tópico de lista" no domínio.
 * Não conhece HTTP nem banco — só o que o negócio precisa saber.
 */
export type ListTopicStatus = "active" | "inactive";

export class ListTopic {
	constructor(
		public readonly url: string,
		public readonly status: ListTopicStatus,
		public readonly gameNames: string[],
	) {}
}
