import {
	Body,
	Controller,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	Req,
	Res,
	UseFilters,
	UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import {
	EnqueueResearchGamesUseCase,
	InvalidResearchRequestError,
} from "@/application/games/use-cases/enqueue-research-games.use-case.js";
import { GameTradeImporter } from "@/application/games/ports/game-trade-importer.port.js";
import { PopularityFetcher } from "@/application/games/ports/game-search.ports.js";
import { ResearchGamesUseCase } from "@/application/games/use-cases/research-games.use-case.js";
import type { Env } from "@/config/env.schema.js";
import {
	SEARCH_PRESET_LABELS,
	SEARCH_PRESET_NAMES,
	SEARCH_PRESETS,
} from "@/domain/games/search-presets.js";
import { GamesLegacyErrorFilter } from "@/nest/games/games-legacy-error.filter.js";
import { ZodValidationPipe } from "@/nest/common/zod-validation.pipe.js";
import { LazyGameTradeImporter } from "@/infrastructure/games/lazy-game-trade-importer.js";
import {
	InternalSecretGuard,
	logResearchConsumer,
	researchConsumer,
} from "@/nest/games/internal-secret.guard.js";
import { ResearchLegacyErrorFilter } from "@/nest/games/research-legacy-error.filter.js";
import {
	toResearchRequest,
	toTopicResearchRequest,
} from "@/nest/games/research-request.mapper.js";
import { TopicResearchErrorFilter } from "@/nest/games/topic-research-error.filter.js";
import {
	type ResearchFromTopicBody,
	type ResearchGamesBody,
	researchFromTopicBodySchema,
	researchGamesBodySchema,
	type SteamIdLookup,
	steamIdLookupResponseSchema,
	steamIdLookupSchema,
} from "@/schemas/game.schema.js";

/**
 * As rotas de `games`: pesquisa de preço (`research`), os presets que a
 * alimentam e a busca de Steam ID. Aqui o pipe valida, o filter traduz o erro, e
 * o método só descreve o caminho feliz.
 *
 * `@UseFilters` porque o 500 de `search-id-steam` diverge do global — ver o
 * filter. `research` declara o próprio.
 */
@Controller("games")
@UseFilters(GamesLegacyErrorFilter)
export class GamesController {
	constructor(
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
	 *
	 * Vale o token de qualquer consumidor (ADR 0012): o do Sistema Estoque e da
	 * interface web, ou o do chatbot.
	 */
	private isAuthenticated(
		token: string | undefined,
		request: Pick<Request, "method" | "path">,
	): boolean {
		const consumer = researchConsumer(this.config, token);
		if (consumer) logResearchConsumer(request, consumer);
		return consumer !== undefined;
	}

	/**
	 * Falha ainda no ciclo da requisição se a integração com o Sistema Estoque não
	 * estiver configurada — depois de enfileirado não há mais ninguém para receber
	 * o erro.
	 */
	private assertStockConfigured(): void {
		if (this.tradeImporter instanceof LazyGameTradeImporter) {
			this.tradeImporter.assertConfigured();
		}
	}

	/**
	 * Resolve o `id_steam` de cada jogo, preservando os que não foram achados.
	 *
	 * Injeta a porta direto, sem use case: não há regra de negócio nenhuma aqui
	 * além de casar nome com resultado.
	 *
	 * `@HttpCode` porque o `@Post()` responde 201 por padrão no Nest, e o contrato
	 * é 200.
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
	 * `currency`, `request_uuid` e `webhook_url` só existem no caminho que
	 * enfileira. Sem token, eles são **400**, não demo: quem os manda espera uma
	 * Trade e um aviso, e um `200` demo seria uma resposta que ninguém vai ler
	 * (ADR 0010). Sem esses campos, token errado continua sendo demo.
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
		@Req() httpRequest: Request,
	) {
		const request = toResearchRequest(body);
		const authenticated = this.isAuthenticated(
			body.internal_secret,
			httpRequest,
		);

		if (
			!authenticated &&
			(body.currency !== undefined ||
				body.request_uuid !== undefined ||
				body.webhook_url !== undefined)
		) {
			throw new InvalidResearchRequestError(
				"currency, request_uuid and webhook_url require a valid internal_secret",
			);
		}

		// Sem token é sempre demo, diga o `delivery` o que disser.
		const delivery = !authenticated ? "demo" : (body.delivery ?? "trade");

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

		this.assertStockConfigured();

		await this.enqueueResearchGamesUseCase.execute({ request });
		response.status(HttpStatus.ACCEPTED);
		return { success: true, status: "queued" };
	}

	/**
	 * A pesquisa a partir do link de um tópico do SteamTrades. Só enfileira: a
	 * raspagem acontece no job, e o resultado vai pelo webhook, como em `research`.
	 *
	 * Token errado é **401**, não demo: esta rota não tem modo demonstração, e o
	 * contrato do demo é só de `research`.
	 */
	@Post("research/from-topic")
	@HttpCode(HttpStatus.ACCEPTED)
	@UseGuards(InternalSecretGuard)
	@UseFilters(TopicResearchErrorFilter)
	async researchFromTopic(
		@Body(new ZodValidationPipe(researchFromTopicBodySchema))
		body: ResearchFromTopicBody,
	) {
		this.assertStockConfigured();

		await this.enqueueResearchGamesUseCase.execute({
			request: toTopicResearchRequest(body),
		});
		return { success: true, status: "queued" };
	}
}
