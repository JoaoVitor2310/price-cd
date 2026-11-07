import {
	type ListTopicFetcher,
	ListTopicFetcherFactory,
} from "@/application/lists/ports/list-run.ports.js";
import { type Disposable, disposeIfPresent } from "@/lib/dispose.js";

/**
 * A fábrica do `ListTopicFetcher`, e a dona dos fetchers em uso.
 *
 * Cada execução descarta o seu no `finally`, e isso basta enquanto o processo
 * vive. No desligamento não: `close(true)` da fila não espera o job, e o Chromium
 * aberto pela leitura ficaria sem ninguém para fechá-lo. Por isso a fábrica lembra
 * de quem entregou e fecha o que sobrou no `onApplicationShutdown`.
 *
 * Fechar derruba a leitura em andamento, e é o esperado: o pedido da fila já foi
 * devolvido antes (`beforeApplicationShutdown`) e roda de novo no próximo boot.
 */
export class TrackedListTopicFetcherFactory extends ListTopicFetcherFactory {
	private readonly live = new Set<ListTopicFetcher>();
	private closed = false;

	constructor(private readonly newFetcher: () => ListTopicFetcher) {
		super();
	}

	create(): ListTopicFetcher {
		if (this.closed) {
			throw new Error("The application is shutting down: no new browser");
		}

		const fetcher = this.newFetcher();
		this.live.add(fetcher);

		const tracked: ListTopicFetcher & Disposable = {
			fetchUserLists: (idSteam) => fetcher.fetchUserLists(idSteam),
			fetchList: (topicRef) => fetcher.fetchList(topicRef),
			dispose: async () => {
				this.live.delete(fetcher);
				await disposeIfPresent(fetcher);
			},
		};
		return tracked;
	}

	async onApplicationShutdown(): Promise<void> {
		this.closed = true;
		await Promise.all([...this.live].map(disposeIfPresent));
		this.live.clear();
	}
}
