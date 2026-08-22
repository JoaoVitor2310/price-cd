import type { TradePaginator } from "@/application/suppliers/ports/trade-paginator.port.js";
import type { TopicScraper } from "@/application/suppliers/ports/topic-scraper.port.js";
import type { CommentPoster } from "@/application/suppliers/ports/comment-poster.port.js";
import type { ProfitabilityChecker, GamePriceInput, SupplierInput } from "@/application/suppliers/ports/profitability-checker.port.js";
import type { GameSearcher } from "@/application/lists/ports/list-run.ports.js";
import { formatResult } from "@/domain/suppliers/profitability.js";
import { TF2_SEARCH_TERMS } from "@/domain/suppliers/tf2-key-matching.js";

const MAX_PAGES = 100;
const MAX_CONSECUTIVE_INACTIVE = 5;
const MAX_CONSECUTIVE_CLOSED = 5;
const MIN_POPULARITY = 30;
const MAX_GAMES_PER_SUPPLIER = 1000;

export type FindNewSuppliersInput = {
    paginator: TradePaginator;
    scraper: TopicScraper;
    commentPoster: CommentPoster;
    profitabilityChecker: ProfitabilityChecker;
    gameSearcher: GameSearcher;
    /** Steam IDs a nunca abordar (ex.: as próprias listas do CarcaDeals). Vazio = ignora ninguém. */
    ignoredSteamIds: ReadonlySet<string>;
};

export type FindNewSuppliersResult = {
    pagesVisited: number;
    topicsProcessed: number;
    suppliersCommented: number;
};

type ProcessDeps = Pick<
    FindNewSuppliersInput,
    "scraper" | "commentPoster" | "profitabilityChecker" | "gameSearcher" | "ignoredSteamIds"
>;

/**
 * Varre as páginas de listagem do SteamTrades (já filtradas por `have=<termo>` na origem,
 * ver `PuppeteerTradePaginator`) em busca de fornecedores potenciais.
 *
 * TF2 Keys é a única moeda aceita hoje — `TF2_SEARCH_TERMS`/`isWantingTf2Keys` (ver
 * `src/domain/suppliers/tf2-key-matching.ts`) e o `total_tf2_price` calculado pelo Sistema
 * Estoque assumem isso. Não há suporte para outra moeda ainda, mas é algo que pretendemos
 * mudar no futuro — quem mexer aqui pra adicionar uma segunda moeda vai precisar generalizar
 * esses dois pontos.
 *
 * Roda em duas fases (`collectTopics` / `processTopics`) para reduzir a janela de exposição
 * a bumps — um usuário pode reordenar sua lista (mover para uma página já visitada) enquanto
 * a varredura está em andamento:
 * 1. **Coleta**: para cada termo em `TF2_SEARCH_TERMS` (a busca do SteamTrades é por
 *    substring exata, então "TF2" sozinho não encontra quem escreveu "Team Fortress 2"
 *    por extenso — precisa varrer uma vez por variação), percorre as páginas extraindo
 *    `{code, url}` de cada lista, deduplicando por `code` no mesmo Map (a mesma lista
 *    pode aparecer em páginas ou termos diferentes). Para de virar página para aquele
 *    termo assim que encontra `MAX_CONSECUTIVE_CLOSED` tópicos fechados seguidos (cadeado
 *    visível já na listagem, via `TradePaginator.isClosed`) — o SteamTrades continua
 *    devolvendo resultados além da última página "real", só que marcados como fechados,
 *    então sem esse corte a coleta andaria até `MAX_PAGES` à toa.
 * 2. **Processamento**: itera as listas únicas coletadas, fazendo o scrape completo.
 *
 * Isso não elimina o race — um bump ainda pode acontecer durante a coleta — mas encolhe
 * bastante a janela, já que coletar `{code, url}` de todas as páginas é muito mais rápido
 * que processar cada lista por completo (scrape + busca de preço + avaliação).
 *
 * Para cada tópico coletado:
 * 1. Verifica se está inativo (`.notification.yellow`) — pula e incrementa o contador de inatividade.
 * 2. Extrai os jogos da seção `.have` e busca preços via GameSearcher.
 * 3. Envia os dados ao Sistema Estoque para avaliação de rentabilidade e decisão de comentar.
 * 4. Se `should_comment === true`, posta comentário.
 *
 * Para de processar antecipadamente quando 5 tópicos inativos são encontrados em sequência
 * entre os coletados (sinal de que chegamos na cauda de anúncios antigos).
 */
export class FindNewSuppliersUseCase {
    async execute(input: FindNewSuppliersInput): Promise<FindNewSuppliersResult> {
        const { paginator, scraper, commentPoster, profitabilityChecker, gameSearcher, ignoredSteamIds } = input;

        const { collectedTopics, pagesVisited } = await this.collectTopics(paginator);

        console.log(`🗂️ [SUPPLIERS] Collected ${collectedTopics.size} unique topic(s) across ${pagesVisited} page(s). Processing...`);

        const { topicsProcessed, suppliersCommented } = await this.processTopics(collectedTopics, {
            scraper,
            commentPoster,
            profitabilityChecker,
            gameSearcher,
            ignoredSteamIds,
        });

        return { pagesVisited, topicsProcessed, suppliersCommented };
    }

    /** Fase 1: varre `TF2_SEARCH_TERMS` × páginas, retornando `{code, url}` únicos por `code`. */
    private async collectTopics(
        paginator: TradePaginator,
    ): Promise<{ collectedTopics: Map<string, string>; pagesVisited: number }> {
        let pagesVisited = 0;
        const collectedTopics = new Map<string, string>();

        for (const searchTerm of TF2_SEARCH_TERMS) {
            console.log(`🔎 [SUPPLIERS] Searching listings for "${searchTerm}"...`);
            let consecutiveClosed = 0;

            pageLoop: for (let page = 1; page <= MAX_PAGES; page++) {
                console.log(`📄 [SUPPLIERS] Scanning page ${page}/${MAX_PAGES} ("${searchTerm}")...`);
                pagesVisited++;

                const topics = await paginator.getTopicsFromPage(page, searchTerm);

                if (topics.length === 0) {
                    console.log(`⚠️ [SUPPLIERS] Page ${page} has no topics for "${searchTerm}". Stopping this search.`);
                    break;
                }

                for (const { code, url, isClosed } of topics) {
                    if (isClosed) {
                        consecutiveClosed++;
                        if (consecutiveClosed >= MAX_CONSECUTIVE_CLOSED) {
                            console.log(`🔒 [SUPPLIERS] ${MAX_CONSECUTIVE_CLOSED} consecutive closed listings for "${searchTerm}". Stopping this search.`);
                            break pageLoop;
                        }
                        continue;
                    }

                    consecutiveClosed = 0;
                    collectedTopics.set(code, url);
                }
            }
        }

        return { collectedTopics, pagesVisited };
    }

    /** Fase 2: processa cada tópico único coletado (scrape → preço → rentabilidade → comentário). */
    private async processTopics(
        collectedTopics: Map<string, string>,
        { scraper, commentPoster, profitabilityChecker, gameSearcher, ignoredSteamIds }: ProcessDeps,
    ): Promise<{ topicsProcessed: number; suppliersCommented: number }> {
        let topicsProcessed = 0;
        let suppliersCommented = 0;
        let consecutiveInactive = 0;

        for (const [code, url] of collectedTopics) {
            try {
                const topic = await scraper.scrape(url);

                if (topic.isInactive) {
                    consecutiveInactive++;
                    console.log(`💤 [SUPPLIERS] Topic ${code} is inactive (${consecutiveInactive}/${MAX_CONSECUTIVE_INACTIVE} consecutive).`);
                    topicsProcessed++;

                    if (consecutiveInactive >= MAX_CONSECUTIVE_INACTIVE) {
                        console.log(`🛑 [SUPPLIERS] ${MAX_CONSECUTIVE_INACTIVE} consecutive inactive topics. Stopping processing.`);
                        break;
                    }
                    continue;
                }

                consecutiveInactive = 0;

                if (!topic.wantsTf2Key) {
                    console.log(`🚫 [SUPPLIERS] Topic ${code} does not want TF2 keys. Skipping.`);
                    continue;
                }

                if (!topic.steamId) {
                    console.warn(`⚠️ [SUPPLIERS] Steam ID not found in topic ${code}. Skipping.`);
                    continue;
                }

                if (ignoredSteamIds.has(topic.steamId)) {
                    console.log(`🚫 [SUPPLIERS] Steam ID ${topic.steamId} is in the ignore list. Skipping topic ${code}.`);
                    continue;
                }

                if (topic.games.length === 0) {
                    topicsProcessed++;
                    console.log(`⚠️ [SUPPLIERS] Topic ${code} has no games in .have section.`);
                    continue;
                }

                const gameNames = topic.games.slice(0, MAX_GAMES_PER_SUPPLIER);
                console.log(`🔍 [SUPPLIERS] Searching prices for ${gameNames.length}/${topic.games.length} game(s) in topic ${code}...`);

                const searchResult = await gameSearcher.search({
                    gameNames,
                    minPopularity: MIN_POPULARITY,
                    checkGamivoOffer: true,
                });

                const gamesWithPrice: GamePriceInput[] = searchResult.games
                    .filter((g) => g.GamivoPrice != null)
                    .map((g) => ({
                        name: g.name,
                        price_euro: g.GamivoPrice as number,
                        popularity: g.popularity,
                        region: g.region ?? null,
                        gamivo_id: g.gamivo_id ?? null,
                    }));

                if (gamesWithPrice.length === 0) {
                    topicsProcessed++;
                    console.log(`💸 [SUPPLIERS] No prices found for games in topic ${code}.`);
                    continue;
                }

                const supplier: SupplierInput = {
                    steam_id: topic.steamId,
                    list_code: code,
                };

                const { profitable: profitableGames, total_tf2_price, is_added, should_comment, last_commented_at, games_changed } =
                    await profitabilityChecker.evaluate(supplier, gamesWithPrice);

                console.log(`📊 [SUPPLIERS] Topic ${code}: should_comment=${should_comment}, games_changed=${games_changed}, last_commented_at=${last_commented_at ?? "never"}`);

                if (!should_comment) {
                    topicsProcessed++;
                    console.log(`⏭️ [SUPPLIERS] Sistema Estoque decided not to comment on topic ${code}.`);
                    continue;
                }

                const formatted = formatResult(profitableGames);
                console.log(`✅ [SUPPLIERS] Commenting on topic ${code} (is_added=${is_added}):\n${formatted}`);

                await commentPoster.post(url, profitableGames, total_tf2_price);
                topicsProcessed++;
                suppliersCommented++;
                console.log(`✅ [SUPPLIERS] Commented on ${code} with ${profitableGames.length} profitable game(s).`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`❌ [SUPPLIERS] Failed to process topic ${code}: ${message}`);
                topicsProcessed++;
            }
        }

        return { topicsProcessed, suppliersCommented };
    }
}
