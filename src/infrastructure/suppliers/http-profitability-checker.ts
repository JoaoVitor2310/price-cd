import type {
    SupplierInput,
    GamePriceInput,
    ProfitabilityChecker,
    ProfitableGameResult,
    ProspectResult,
} from "@/application/suppliers/ports/profitability-checker.port.js";
import type { Offer, OfferCurrency } from "@/domain/suppliers/offer.js";

const PROFITABILITY_ENDPOINT = "/suppliers/prospect";

/**
 * O que o Sistema Estoque devolve de fato: o `ProspectResult` sem o `offer` — que o price-cd monta a
 * partir daqui — e com os campos de oferta em dinheiro como opcionais. Eles são opcionais porque
 * dependem do pedido e da cotação, não porque o contrato esteja incompleto: só vêm quando a moeda
 * pedida é `eur`/`usd` **e** a TF2 tem cotação nessa moeda (ver `docs/PRICE_RESEARCHER_OFFER_CURRENCY.md`
 * no Sistema Estoque).
 */
export type ProspectWire = Omit<ProspectResult, "offer" | "profitable"> & {
    profitable: Array<ProfitableGameResult & { offer_price?: number }>;
    /** Moeda em que `offer_price`/`total_offer_price` estão. Ecoa o `offer_currency` pedido. */
    offer_currency?: OfferCurrency;
    total_offer_price?: number;
};

const isAmount = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Traduz a resposta do Sistema Estoque para o `ProspectResult` do price-cd, montando a oferta na
 * moeda pedida. Exportada separadamente para testar a regra sem HTTP.
 *
 * É a fronteira com o outro sistema: o resto do price-cd nunca vê `offer_price` nem
 * `total_offer_price`, só uma `Offer` pronta. Se o contrato mudar de forma, muda só este arquivo.
 *
 * **Não presume que a resposta cumpre o contrato.** O comentário é público e irreversível: um valor
 * em TF2 escrito como se fosse euro — ou um decimal que chegou como string — seria uma oferta
 * errada na Lista do fornecedor, sem como desfazer. O Sistema Estoque é outro sistema, com código e
 * contrato próprios, então um bug ou uma deriva de lá não pode virar texto publicado aqui. Por isso,
 * em dinheiro, se a resposta não trouxer a oferta na moeda pedida — outra moeda, campo ausente ou
 * valor que não é número — esta função lança, e "não comentar" é o único desfecho seguro.
 *
 * TF2 usa os campos que sempre existiram (`tf2_price`/`total_tf2_price`), então esse fluxo não
 * depende dos campos novos.
 *
 * `offer` é `null` quando `should_comment` é `false`. Sem comentário a postar nada é validado:
 * exigir a oferta transformaria o caso mais comum (o Sistema Estoque decidir não comentar) em erro.
 */
export function toProspectResult(wire: ProspectWire, currency: OfferCurrency): ProspectResult {
    const { offer_currency: _offerCurrency, total_offer_price: _totalOfferPrice, profitable, ...rest } = wire;
    const games: ProfitableGameResult[] = profitable.map(({ offer_price: _offerPrice, ...game }) => game);

    return { ...rest, profitable: games, offer: buildOffer(wire, currency) };
}

function buildOffer(wire: ProspectWire, currency: OfferCurrency): Offer | null {
    if (!wire.should_comment) return null;

    if (currency === "tf2") {
        return {
            currency,
            lines: wire.profitable.map((game) => ({ name: game.name, amount: game.tf2_price })),
            total: wire.total_tf2_price,
        };
    }

    const honored =
        wire.offer_currency === currency &&
        isAmount(wire.total_offer_price) &&
        wire.profitable.every((game) => isAmount(game.offer_price));

    if (!honored) {
        throw new Error(
            `Sistema Estoque did not return an offer in "${currency}" (got offer_currency=${String(wire.offer_currency)}). Refusing to comment.`,
        );
    }

    return {
        currency,
        lines: wire.profitable.map((game) => ({ name: game.name, amount: game.offer_price as number })),
        total: wire.total_offer_price as number,
    };
}

/**
 * Implementação de `ProfitabilityChecker` via HTTP.
 * Delega ao Sistema Estoque: cálculo de rentabilidade, conversão para a Moeda de oferta da Lista
 * (TF2 Keys, euro ou dólar) e decisão de comentar (`should_comment`).
 */
export class HttpProfitabilityChecker implements ProfitabilityChecker {
    constructor(
        private readonly baseUrl: string,
        private readonly bearerToken: string,
    ) {}

    async evaluate(supplier: SupplierInput, games: GamePriceInput[], currency: OfferCurrency): Promise<ProspectResult> {
        const url = `${this.baseUrl}${PROFITABILITY_ENDPOINT}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000);

        try {
            const response = await fetch(url, {
                method: "POST",
                signal: controller.signal,
                // Sem `Accept: application/json`, um framework web responde a uma rejeição (validação,
                // auth) com redirect para uma página HTML, e o `fetch` o seguiria até um `200` com HTML
                // — que estourava como "Unexpected token '<'" sem dizer o que foi rejeitado. Com
                // `redirect: "manual"` o 3xx chega aqui como erro e cai no ramo `!response.ok`.
                redirect: "manual",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    Authorization: `Bearer ${this.bearerToken}`,
                },
                body: JSON.stringify({
                    supplier_steam_id: supplier.steam_id,
                    list_code: supplier.list_code,
                    offer_currency: currency,
                    games,
                }),
            });

            if (!response.ok) {
                const body = await response.text().catch(() => undefined);
                console.error(`❌ [PROFITABILITY] HTTP ${response.status} — POST ${url}`);
                const location = response.headers?.get("location");
                if (location) console.error(`❌ [PROFITABILITY] Redirected to: ${location}`);
                console.error(`❌ [PROFITABILITY] Response body:`, body);
                throw new Error(`POST ${url} failed with status ${response.status}`);
            }

            return toProspectResult(await this.parseJson(response, url), currency);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                console.error(`❌ [PROFITABILITY] Request timed out — POST ${url}`);
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Lê o corpo como texto antes de parsear: `response.json()` descarta o corpo quando falha, e
     * "Unexpected token '<'" não diz quem respondeu nem o quê. O erro agora carrega status,
     * `content-type` e o começo do corpo — o suficiente para distinguir proxy, página de login e
     * rejeição de payload.
     */
    private async parseJson(response: Response, url: string): Promise<ProspectWire> {
        const text = await response.text();
        try {
            return JSON.parse(text) as ProspectWire;
        } catch {
            const contentType = response.headers?.get("content-type") ?? "unknown";
            console.error(`❌ [PROFITABILITY] Non-JSON body from POST ${url} (HTTP ${response.status}, ${contentType}):`, text.slice(0, 500));
            throw new Error(
                `POST ${url} returned a non-JSON body (HTTP ${response.status}, content-type ${contentType}): ${text.slice(0, 200)}`,
            );
        }
    }
}
