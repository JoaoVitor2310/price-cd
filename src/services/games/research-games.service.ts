import { ResearchGamesUseCase } from "@/application/games/research-games.use-case.js";
import { EnqueueResearchGamesUseCase } from "@/application/games/enqueue-research-games.use-case.js";
import type {
	ResearchGamesRequest,
	ResearchGamesRunner,
} from "@/application/games/ports/research-games-runner.port.js";
import type { GameTradeInput } from "@/application/games/ports/game-trade-importer.port.js";
import type { BackgroundScheduler } from "@/application/shared/ports/background-scheduler.port.js";
import { LimitedConcurrencyScheduler } from "@/infrastructure/background/limited-concurrency.scheduler.js";
import { SteamChartsPopularityFetcher } from "@/infrastructure/games/steam-charts-popularity-fetcher.js";
import { AllKeyShopPriceFetcher } from "@/infrastructure/games/allkeyshop-price-fetcher.js";
import { HttpGameTradeImporter } from "@/infrastructure/games/http-game-trade-importer.js";

const researchGamesUseCase = new ResearchGamesUseCase();
const enqueueResearchGamesUseCase = new EnqueueResearchGamesUseCase();
const popularityFetcher = new SteamChartsPopularityFetcher();
const priceFetcher = new AllKeyShopPriceFetcher();

let _tradeImporter: HttpGameTradeImporter | undefined;

function getTradeImporter(): HttpGameTradeImporter {
	if (!_tradeImporter) {
		const baseUrl = process.env.SISTEMA_ESTOQUE_URL?.trim();
		const secret = process.env.EXTERNAL_SECRET?.trim();
		if (!baseUrl) throw new Error("SISTEMA_ESTOQUE_URL is not defined in .env");
		if (!secret) throw new Error("EXTERNAL_SECRET is not defined in .env");
		_tradeImporter = new HttpGameTradeImporter(baseUrl, secret);
	}
	return _tradeImporter;
}

/** Lança se a integração com o Sistema Estoque não estiver configurada. */
function assertTradeImporterConfigured(): void {
	getTradeImporter();
}

/**
 * Fila própria da pesquisa manual, separada da fila do fluxo `lists`:
 * uma execução de listas longa não deve travar uma pesquisa disparada por um usuário.
 * Concorrência 1 — o scraping do AllKeyShop já é serializado pelo browser compartilhado.
 */
let _scheduler: BackgroundScheduler | undefined;

function getScheduler(): BackgroundScheduler {
	if (!_scheduler) {
		_scheduler = new LimitedConcurrencyScheduler(1);
	}
	return _scheduler;
}

class ResearchGamesServiceRunner implements ResearchGamesRunner {
	async run(request: ResearchGamesRequest): Promise<void> {
		await researchGamesUseCase.execute({
			...request,
			popularityFetcher,
			priceFetcher,
			tradeImporter: getTradeImporter(),
		});
	}
}

/**
 * Fluxo autenticado: enfileira a pesquisa e retorna imediatamente.
 * A Trade é criada no Sistema Estoque ao final do processamento.
 */
export const enqueueResearchGamesService = async (request: ResearchGamesRequest): Promise<void> => {
	// Falha cedo, ainda no ciclo da requisição, se a integração não estiver configurada —
	// depois de enfileirar não há mais ninguém para receber o erro.
	assertTradeImporterConfigured();

	await enqueueResearchGamesUseCase.execute({
		request,
		scheduler: getScheduler(),
		runner: new ResearchGamesServiceRunner(),
	});
};

/**
 * Fluxo de demonstração (sem token): roda de forma síncrona e devolve os jogos
 * encontrados, porque o resultado é exibido na própria tela. Nada é enviado
 * ao Sistema Estoque.
 */
export const researchGamesDemoService = async (
	request: ResearchGamesRequest,
): Promise<GameTradeInput[] | null> => {
	return researchGamesUseCase.execute({
		...request,
		popularityFetcher,
		priceFetcher,
		tradeImporter: undefined,
	});
};
