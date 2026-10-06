/**
 * A Moeda de oferta: aquela em que o CarcaDeals propõe pagar o Fornecedor por uma Lista (ver
 * `CONTEXT.md`). Sai do que a Lista aceita, não de uma configuração — o mesmo Fornecedor pode
 * receber TF2 Keys numa Lista e euros em outra.
 *
 * `tf2` é TF2 Key, `eur` é euro, `usd` é dólar. O PayPal não é moeda: é um meio de pagamento
 * em euro por padrão, então ele cai em `eur`.
 */
export type OfferCurrency = "tf2" | "eur" | "usd";

/** As Moedas de oferta que são dinheiro, ou seja, todas menos TF2 Keys. */
export type MoneyCurrency = Exclude<OfferCurrency, "tf2">;

export type OfferLine = {
    name: string;
    /** Valor ofertado por este jogo, expresso em `Offer.currency`. */
    amount: number;
};

/**
 * O que o comentário propõe ao Fornecedor, já na Moeda de oferta da Lista.
 *
 * Quem converte é o Sistema Estoque, que é dono do preço da TF2 Key e das margens (ADR 0001) —
 * o price-cd só carrega o valor até o texto do comentário, e nunca calcula nem converte.
 */
export type Offer = {
    currency: OfferCurrency;
    lines: readonly OfferLine[];
    /** Total da Trade, na mesma moeda de `lines`. */
    total: number;
};
