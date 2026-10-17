import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Res,
	UseFilters,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { EnqueueResearchGamesUseCase } from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { PopularityFetcher } from "@/application/games/ports/game-search.ports.js";
import { ResearchGamesUseCase } from "@/application/games/use-cases/research-games.use-case.js";
import type { Env } from "@/config/env.schema.js";
import {
	SEARCH_PRESET_LABELS,
	SEARCH_PRESET_NAMES,
	SEARCH_PRESETS,
} from "@/domain/games/search-presets.js";
import { SearchGamesUseCase } from "@/application/games/use-cases/search-games.use-case.js";
import { GamesLegacyErrorFilter } from "@/nest/games/games-legacy-error.filter.js";
import { ZodValidationPipe } from "@/nest/common/zod-validation.pipe.js";
import { LazyGameTradeImporter } from "@/infrastructure/games/lazy-game-trade-importer.js";
import { ResearchLegacyErrorFilter } from "@/nest/games/research-legacy-error.filter.js";
import { toResearchRequest } from "@/nest/games/research-request.mapper.js";
import {
	type GameSearch,
	gameSearchSchema,
	type ResearchGamesBody,
	researchGamesBodySchema,
	type SteamIdLookup,
	steamIdLookupResponseSchema,
	steamIdLookupSchema,
} from "@/schemas/game.schema.js";

/**
 * As duas rotas síncronas de busca.
 *
 * Substitui `routes/games/search.route.ts`, `search-id-steam.route.ts` e os dois
 * controllers correspondentes — que eram praticamente o mesmo arquivo, repetindo
 * o `try/catch` de `ZodError` e `Error`. Aqui o pipe valida, o filter traduz o
 * erro, e o método só descreve o caminho feliz.
 *
 * `@UseFilters` porque o 500 destas rotas diverge do global — ver o filter.
 */
@Controller("games")
@UseFilters(GamesLegacyErrorFilter)
export class GamesController {
	constructor(
		private readonly searchGamesUseCase: SearchGamesUseCase,
		private readonly popularityFetcher: PopularityFetcher,
		private readonly researchGamesUseCase: ResearchGamesUseCase,
		private readonly enqueueResearchGamesUseCase: EnqueueResearchGamesUseCase,
		private readonly tradeImporter: GameTradeImporter,
		private readonly config: ConfigService<Env, true>,
	) {}

	/**
	 * Token ausente ou errado **não** é rejeição — é modo demonstração.
	 *
	 * Por isso isto NÃO é um `@UseGuards()`. Guard que retorna `false` rejeita a
	 * requisição com 403, e o contrato aqui manda responder **200 com o resultado
	 * demo**. Um Guard mudaria o status e quebraria o cliente público.
	 *
	 * Ver `docs/nest-conceitos.md` §6 e o caso de contrato
	 * "wrong internal_secret returns 200 demo, not 403".
	 */
	private isAuthenticated(token: string | undefined): boolean {
		const secret = this.config.get("INTERNAL_SECRET", { infer: true })?.trim();
		return !!secret && token === secret;
	}

	// `@Post()` responde 201 por padrão no Nest; o Express respondia 200, e o
	// contrato é 200. A bateria pegou isso na primeira execução.
	@Post("search")
	@HttpCode(HttpStatus.OK)
	async search(@Body(new ZodValidationPipe(gameSearchSchema)) body: GameSearch) {
		return { success: true, data: await this.searchGamesUseCase.execute(body) };
	}

	/**
	 * Resolve o `id_steam` de cada jogo, preservando os que não foram achados.
	 *
	 * Injeta a porta direto, sem use case: não há regra de negócio nenhuma aqui
	 * além de casar nome com resultado. Criar um use case só para ter simetria
	 * com `/search` seria cerimônia vazia.
	 */
	@Post("search-id-steam")
	@HttpCode(HttpStatus.OK)
	async searchIdSteam(
		@Body(new ZodValidationPipe(steamIdLookupSchema)) body: SteamIdLookup,
	) {
		const found = await this.popularityFetcher.fetch(
			body.games.map((game) => game.name),
			true,
		);

		const games = body.games.map((game) => ({
			id: game.id,
			name: game.name,
			id_steam: found.find((result) => result.name === game.name)?.id_steam,
		}));

		return {
			success: true,
			data: steamIdLookupResponseSchema.parse({ games }),
		};
	}

	/**
	 * Os presets de pesquisa, para a página preencher o formulário. Fonte única:
	 * a página não guarda cópia de nenhum valor.
	 */
	@Get("presets")
	presets() {
		const presets = Object.fromEntries(
			SEARCH_PRESET_NAMES.map((name) => [
				name,
				{ label: SEARCH_PRESET_LABELS[name], ...SEARCH_PRESETS[name] },
			]),
		);
		return { success: true, presets };
	}

	/**
	 * Três respostas na mesma rota, decididas pelo token e por `delivery`:
	 *
	 * - sem token (ou token errado): demo síncrono, **200** com até 10 jogos;
	 * - token + `delivery: "trade"` (padrão): enfileira, **202**, e a Trade é criada
	 *   no Sistema Estoque ao terminar;
	 * - token + `delivery: "respond"`: síncrono, **200** com todos os jogos e sem
	 *   criar Trade — o caso da sync de bundle.
	 *
	 * `@Res({ passthrough: true })` em vez de `@HttpCode`: o status depende do
	 * corpo da requisição, não da rota, então não dá para declará-lo no decorator.
	 * `passthrough` mantém o Nest responsável por serializar o retorno — sem ele
	 * seria preciso chamar `res.json()` à mão e o filter perderia o controle da
	 * resposta.
	 */
	@Post("research")
	@UseFilters(ResearchLegacyErrorFilter)
	async research(
		@Body(new ZodValidationPipe(researchGamesBodySchema)) body: ResearchGamesBody,
		@Res({ passthrough: true }) response: Response,
	) {
		const request = toResearchRequest(body);

		// Sem token é sempre demo, diga o `delivery` o que disser.
		const delivery = !this.isAuthenticated(body.internal_secret)
			? "demo"
			: (body.delivery ?? "trade");

		if (delivery !== "trade") {
			const games = await this.researchGamesUseCase.execute({ ...request, delivery });
			// Explícito, e não `@HttpCode(200)`: no modo `passthrough` o decorator
			// sobrescreve o que o handler define, então o 202 abaixo seria engolido.
			response.status(HttpStatus.OK);
			// `demo: true` é contrato: o Sistema Estoque o usa para detectar segredo
			// errado. Na entrega `respond` o campo não existe.
			return delivery === "demo"
				? { success: true, demo: true, games }
				: { success: true, games };
		}

		// Falha ainda no ciclo da requisição se a integração com o Sistema
		// Estoque não estiver configurada — depois de enfileirado não há mais
		// ninguém para receber o erro.
		if (this.tradeImporter instanceof LazyGameTradeImporter) {
			this.tradeImporter.assertConfigured();
		}

		await this.enqueueResearchGamesUseCase.execute({ request });
		response.status(HttpStatus.ACCEPTED);
		return { success: true, status: "queued" };
	}
}
