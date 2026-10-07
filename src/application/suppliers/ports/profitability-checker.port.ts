import type { Offer, OfferCurrency } from "@/domain/suppliers/offer.js";

/** Dados do fornecedor enviados ao Sistema Estoque para identificação e registro. */
export type SupplierInput = {
    steam_id: string;
    /** Código do tópico no SteamTrades (ex.: `G0eXM`). Usado pelo Sistema Estoque para rastrear histórico por tópico. */
    list_code: string;
};

/** Jogo com preço já descoberto pelo price researcher, pronto para avaliação de rentabilidade. */
export type GamePriceInput = {
    name: string;
    /**
     * Preço de **mercado** em EUR obtido no AllKeyShop/Gamivo — não a oferta ao fornecedor (essa é
     * `Offer`). O nome carrega "market" para não se confundir com `offer_price`.
     */
    market_price_euro: number;
    /** Pico de jogadores em 24h no SteamCharts. */
    popularity: number;
    /** Região da oferta: "global", "eu", "row", ou null se não identificado. */
    region: string | null;
    /** ID do produto na Gamivo, ou null se não identificado. */
    gamivo_id: string | null;
};

export type ProfitableGameResult = {
    name: string;
    /** Preço de mercado em EUR, devolvido pelo Sistema Estoque junto do jogo. */
    market_price_euro: number;
    popularity: number;
    region: string | null;
    /** Preço em keys TF2, calculado pelo Sistema Estoque. */
    tf2_price: number;
};

export type ProspectResult = {
    profitable: ProfitableGameResult[];
    /** Soma dos `tf2_price` de todos os jogos rentáveis, calculada pelo Sistema Estoque. */
    total_tf2_price: number;
    /**
     * O que propor ao fornecedor, já na Moeda de oferta pedida em `evaluate`. Para `tf2` são os
     * mesmos `tf2_price`/`total_tf2_price` acima; para `eur`/`usd` vêm convertidos pelo Sistema
     * Estoque.
     *
     * É `null` **exatamente quando** `should_comment` é `false`, em qualquer moeda: sem comentário a
     * postar não há oferta a mostrar. Com `should_comment` verdadeiro o adapter garante uma oferta —
     * ou lança, nunca devolve `null` nem uma oferta inventada.
     */
    offer: Offer | null;
    /** Se o fornecedor já está adicionado como contato no Sistema Estoque. */
    is_added: boolean;
    /** `true` se o price-cd deve postar comentário no tópico. Decisão tomada pelo Sistema Estoque. */
    should_comment: boolean;
    /** ISO 8601 do último comentário registrado para este `list_code`. `null` se nunca comentamos. Usado para logging. */
    last_commented_at: string | null;
    /** `true` se a lista de jogos mudou desde o último comentário registrado. Usado para logging. */
    games_changed: boolean;
};

export abstract class ProfitabilityChecker {
    /**
     * `currency` é a Moeda de oferta da Lista: o Sistema Estoque calcula `offer` nela. Um adapter
     * que não consiga entregar `offer` na moeda pedida **lança** — nunca devolve outra moeda,
     * porque o valor iria para um comentário público como se fosse a que o fornecedor aceita.
     */
    abstract evaluate(
        supplier: SupplierInput,
        games: GamePriceInput[],
        currency: OfferCurrency,
    ): Promise<ProspectResult>;
}
